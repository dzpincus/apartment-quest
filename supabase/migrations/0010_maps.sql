-- Apartment Quest — maps, saved locations, commute times
--
-- Applies after 0009. Re-runnable.
--
-- 1. listings.lat / lng / geocoded_at / geocode_note — where the apartment
--    actually is, resolved once by `POST /api/geocode` and stored, so the map
--    and the commute cache never geocode at read time.
-- 2. locations — the shared list of saved places (work, gym, parents). Shared
--    on purpose: four people, one hunt. Which of them a given *device* wants
--    to see is a preference, not data, and lives in localStorage
--    (`aq.locations.hidden:<personId>`, `src/lib/prefs.ts`).
-- 3. commute_times — the cache, one row per listing x location x mode. Google
--    Routes is metered; this table is what keeps the bill at "computed once".
-- 4. Triggers: an edited address invalidates its own pin *and* its cached
--    times, because both were answers about a different building.
-- 5. merge_listings — redefined a seventh time so the coordinates and the
--    cached times survive a merge.

-- columns --------------------------------------------------------------------
-- `geocode_note` carries the provenance, not a status: 'nyc-geosearch',
-- 'nominatim', 'low-confidence (nyc-geosearch)' when the match was a guess
-- worth checking, or 'failed: <reason>' when nobody could place it. Null lat
-- with a `failed:` note is "we looked and could not find it"; null lat with a
-- null note is "nobody has looked yet".

alter table listings
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists geocoded_at timestamptz,
  add column if not exists geocode_note text;

-- The map reads every live listing that has a pin. Partial on `merged_into is
-- null` for the same reason `listings_sync` (0006) is partial: merged rows are
-- never shown anywhere, so they have no business in the index either.
create index if not exists listings_geo on listings (lat, lng)
  where merged_into is null;

-- locations ------------------------------------------------------------------
-- Geocoded by the same route the listings use, before the row is written, so a
-- location without coordinates is not a state this table can be in.
create table if not exists locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null,
  lat double precision not null,
  lng double precision not null,
  emoji text,
  added_by uuid references people(id),
  created_at timestamptz default now()
);

-- commute_times --------------------------------------------------------------
-- One row per (listing, location, mode). `seconds`/`meters` null with `error`
-- set is a pair Google refused; the UI shows "—" and the Google Maps deep link
-- still works, because that one costs nothing and needs no key.
--
-- `computed_at` is the cost guard: `/api/commutes` never recomputes a row
-- younger than 30 days unless it is asked to with `force`.
create table if not exists commute_times (
  listing_id uuid references listings(id) on delete cascade,
  location_id uuid references locations(id) on delete cascade,
  mode text check (mode in ('walk', 'bike', 'transit')),
  seconds int,
  meters int,
  computed_at timestamptz default now(),
  error text,
  primary key (listing_id, location_id, mode)
);

-- The commute card reads one listing's rows; the batch route reads one
-- location's when a place has just been added.
create index if not exists commute_times_location on commute_times (location_id);

-- rls ------------------------------------------------------------------------
-- Same single `authenticated` policy every other table gets (0002). One shared
-- login, no per-person boundary — intentional, see SPEC.md.
alter table locations     enable row level security;
alter table commute_times enable row level security;

drop policy if exists locations_authenticated     on locations;
drop policy if exists commute_times_authenticated on commute_times;

create policy locations_authenticated on locations
  for all to authenticated using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy commute_times_authenticated on commute_times
  for all to authenticated using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- realtime -------------------------------------------------------------------
-- Idempotent: `alter publication ... add table` errors if the table is already
-- a member. Same loop as 0003/0004/0007, with the two new tables on the end.
-- `commute_times` maps to the `listings` / `listing(id)` keys in
-- `src/lib/realtime.tsx` (the rows arrive embedded in a listing), which is what
-- makes a batch run fill the card in live rather than after a refresh.
do $$
declare
  t text;
begin
  foreach t in array array[
    'messages', 'listings', 'votes', 'activity', 'interactions', 'brokers',
    'people', 'listing_photos', 'locations', 'commute_times'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

-- address edits --------------------------------------------------------------
-- A pin is an answer about an address. Change the address and the answer is
-- wrong, so it goes — along with every commute time derived from it, which was
-- a measurement from a building this listing is no longer in.
--
-- Two triggers, because they are two different jobs at two different times: the
-- BEFORE one edits the row on its way through (no second UPDATE, so no second
-- pass through `set_updated_at`), and the AFTER one deletes from another table
-- once this row is actually committed to its new address.
--
-- `is distinct from` rather than `<>`: a unit going from null to '4B' is a
-- change, and `null <> '4B'` is null, which a WHEN clause reads as "no".
--
-- Both functions stand down while `merge_listings` is running (`aq.merging`,
-- set with `is_local` so it dies with the transaction). A merge fills a blank
-- `unit` from the duplicate — that is the whole point of the backfill — and
-- without the guard that write would read as an address edit: the pin the same
-- statement had just carried across would be nulled again and the commute
-- rows carried across two statements earlier would be deleted. The building
-- did not move; somebody typed the apartment number in.
create or replace function clear_listing_geocode()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('aq.merging', true), '') = 'on' then
    return new;
  end if;
  new.lat := null;
  new.lng := null;
  new.geocoded_at := null;
  new.geocode_note := null;
  return new;
end;
$$;

drop trigger if exists listings_address_changed on listings;
create trigger listings_address_changed
  before update on listings
  for each row
  when (
    old.address is distinct from new.address
    or old.unit is distinct from new.unit
  )
  execute function clear_listing_geocode();

create or replace function clear_listing_commutes()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('aq.merging', true), '') = 'on' then
    return null;
  end if;
  delete from commute_times where listing_id = new.id;
  return null;
end;
$$;

drop trigger if exists listings_address_changed_commutes on listings;
create trigger listings_address_changed_commutes
  after update on listings
  for each row
  when (
    old.address is distinct from new.address
    or old.unit is distinct from new.unit
  )
  execute function clear_listing_commutes();

-- merge_listings -------------------------------------------------------------
-- Redefinition of the 0009 function, which is otherwise reproduced verbatim.
-- Two changes:
--
-- 1. The geo columns join the `coalesce` list. A duplicate that was geocoded
--    and a survivor that was not is the common case — the survivor keeps its
--    own pin if it has one, and inherits the duplicate's if it does not.
-- 2. `commute_times` are repointed like votes and thread_reads: insert the
--    source's rows under the target's id, `on conflict do nothing` (the target
--    already having measured that pair wins), then delete the source's. Doing
--    it as an `update ... set listing_id = dst` would raise on the primary key
--    the moment both rows had measured the same location and mode.
--
-- The backfill *does* fill a blank `unit` from the duplicate, which is an
-- address change as far as the triggers above are concerned, so the function
-- announces itself with `aq.merging` (transaction-local) and they stand down.
-- Without that, folding "214 Grand St" into "214 Grand St #4B" would null the
-- pin and delete the commute rows this function had just carried across.
--
-- CREATE OR REPLACE rewrites a function's configuration too, so
-- `set search_path = public` is restated here — same reason it is restated in
-- 0004, 0005, 0007, 0008 and 0009.
create or replace function merge_listings(src uuid, dst uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  dst_merged uuid;
  dst_found boolean;
begin
  if src = dst then
    raise exception 'cannot merge a listing into itself';
  end if;

  select true, l.merged_into into dst_found, dst_merged
  from listings l where l.id = dst;

  if not coalesce(dst_found, false) then
    raise exception 'merge target % does not exist', dst;
  end if;
  if dst_merged is not null then
    raise exception 'merge target % is itself merged into %', dst, dst_merged;
  end if;

  -- Transaction-local, so it cannot leak into the next statement on this
  -- connection: the two `listings_address_changed` triggers (0010) read it and
  -- stand down for the backfill below.
  perform set_config('aq.merging', 'on', true);

  update interactions    set listing_id = dst where listing_id = src;
  update messages        set listing_id = dst where listing_id = src;
  update listing_photos  set listing_id = dst where listing_id = src;

  insert into votes (listing_id, person_id, vote, comment, updated_at)
  select dst, v.person_id, v.vote, v.comment, v.updated_at
  from votes v where v.listing_id = src
  on conflict (listing_id, person_id) do nothing;
  delete from votes where listing_id = src;

  insert into thread_reads (person_id, listing_id, last_read_at)
  select t.person_id, dst, t.last_read_at
  from thread_reads t where t.listing_id = src
  on conflict (person_id, listing_id) do nothing;
  delete from thread_reads where listing_id = src;

  -- commute times (0010): the cache follows the survivor, and anything it had
  -- already measured for itself wins.
  insert into commute_times (listing_id, location_id, mode, seconds, meters, computed_at, error)
  select dst, c.location_id, c.mode, c.seconds, c.meters, c.computed_at, c.error
  from commute_times c where c.listing_id = src
  on conflict (listing_id, location_id, mode) do nothing;
  delete from commute_times where listing_id = src;

  update listings d set
    unit              = coalesce(d.unit, s.unit),
    neighborhood      = coalesce(d.neighborhood, s.neighborhood),
    rent              = coalesce(d.rent, s.rent),
    beds              = coalesce(d.beds, s.beds),
    baths             = coalesce(d.baths, s.baths),
    sqft              = coalesce(d.sqft, s.sqft),
    url               = coalesce(d.url, s.url),
    available_date    = coalesce(d.available_date, s.available_date),
    broker_fee_pct    = coalesce(d.broker_fee_pct, s.broker_fee_pct),
    guarantor_ok      = coalesce(d.guarantor_ok, s.guarantor_ok),
    trains            = coalesce(d.trains, s.trains),
    notes             = coalesce(d.notes, s.notes),
    broker_id         = coalesce(d.broker_id, s.broker_id),
    -- pet policy: 'unknown' is an absence, not an answer
    pets              = case
                          when d.pets = 'unknown' or d.pets is null then s.pets
                          else d.pets
                        end,
    pet_notes         = coalesce(d.pet_notes, s.pet_notes),
    -- amenities (0009): same rule as pets, four more times
    laundry           = case
                          when d.laundry = 'unknown' or d.laundry is null
                            then s.laundry
                          else d.laundry
                        end,
    dishwasher        = case
                          when d.dishwasher = 'unknown' or d.dishwasher is null
                            then s.dishwasher
                          else d.dishwasher
                        end,
    ac                = case
                          when d.ac = 'unknown' or d.ac is null then s.ac
                          else d.ac
                        end,
    outdoor_space     = case
                          when d.outdoor_space = 'unknown' or d.outdoor_space is null
                            then s.outdoor_space
                          else d.outdoor_space
                        end,
    -- follow-up state: the merged row must stay in the queue
    last_contacted_at = greatest(d.last_contacted_at, s.last_contacted_at),
    next_action       = coalesce(d.next_action, s.next_action),
    next_action_due   = coalesce(d.next_action_due, s.next_action_due),
    next_action_owner = coalesce(d.next_action_owner, s.next_action_owner),
    -- link state (0006): 'unknown' is an absence here too, and the last look
    -- at this apartment is whichever row looked most recently
    listing_state     = case
                          when d.listing_state = 'unknown' or d.listing_state is null
                            then s.listing_state
                          else d.listing_state
                        end,
    state_checked_at  = greatest(d.state_checked_at, s.state_checked_at),
    state_note        = coalesce(d.state_note, s.state_note),
    -- geo (0010): the survivor keeps its own pin, or takes the duplicate's.
    -- The note and the stamp travel with the coordinates they describe, so a
    -- borrowed pin does not arrive labelled as this row's own lookup.
    lat               = coalesce(d.lat, s.lat),
    lng               = coalesce(d.lng, s.lng),
    geocoded_at       = coalesce(d.geocoded_at, s.geocoded_at),
    geocode_note      = coalesce(d.geocode_note, s.geocode_note)
  from listings s
  where d.id = dst and s.id = src;

  update listings set merged_into = dst where id = src;

  -- Back on, in case the caller wraps this RPC in a transaction that goes on
  -- to edit an address for real.
  perform set_config('aq.merging', 'off', true);
end;
$$;

-- search_path hardening ------------------------------------------------------
-- Same belt and braces as 0004/0005/0007/0008/0009.
alter function merge_listings(uuid, uuid) set search_path = public;
alter function clear_listing_geocode() set search_path = public;
alter function clear_listing_commutes() set search_path = public;
