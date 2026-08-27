-- Apartment Quest — spotlights ("Look at this one!")
--
-- Applies after 0011. Re-runnable.
--
-- 1. spotlights — one row per person, and the primary key says so: promoting a
--    second listing *replaces* the first rather than adding to it. Four people,
--    four rows, maximum. That is the whole feature — "here is the one I want
--    you to look at, and here is why" — and the cap is what keeps it loud.
-- 2. The `note` is the point. A spotlight with no reason is a bookmark, which
--    the app already has (votes, the queue, the thread); the note is what makes
--    it a thing said to three other people. Nullable all the same: promoting a
--    listing and typing nothing is still a signal, it just prints without the
--    quote block.
-- 3. RLS + realtime, exactly like every other table.
-- 4. merge_listings — redefined an eighth time so a spotlight follows the
--    survivor of a merge rather than pointing at a hidden row.
--
-- A dead listing is NOT deleted from here. `activeSpotlights` in
-- `src/lib/spotlight.ts` drops merged rows and `passed`/`lost` ones at read
-- time, so passing on an apartment quietly retires the spotlight without a
-- second write — and un-passing it brings the spotlight back, which is the
-- behaviour somebody who mis-clicked Passed actually wants.

-- table ----------------------------------------------------------------------
-- `person_id` is the primary key, not a surrogate id with a unique index on
-- top: "one per person" is the shape of the data, so it is the shape of the
-- key, and `on conflict (person_id) do update` is then the natural write.
--
-- Both foreign keys cascade: deleting a person or a listing must not leave a
-- spotlight pointing at nothing. There is no `on delete set null` option here —
-- a spotlight with no listing is not a smaller spotlight, it is a bug.
create table if not exists spotlights (
  person_id  uuid primary key references people(id) on delete cascade,
  listing_id uuid not null references listings(id) on delete cascade,
  -- The "why", shown big on Home. Capped at 280 characters in the dialog, not
  -- here: this is a shout across a room, not an essay, and a length a person
  -- can see themselves running out of belongs in the input.
  note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The listings table and the mobile cards badge a row that anybody spotlighted,
-- so the lookup goes the other way as well as `person_id`'s own key.
create index if not exists spotlights_listing on spotlights (listing_id);

-- updated_at -----------------------------------------------------------------
-- Same trigger every mutable table gets (0003). The clock stays server-side, so
-- a device running fast cannot claim it re-pointed its spotlight in the future.
drop trigger if exists spotlights_set_updated_at on spotlights;
create trigger spotlights_set_updated_at
  before update on spotlights
  for each row execute function set_updated_at();

-- rls ------------------------------------------------------------------------
-- The 0011 shape: one `for all to authenticated` policy pinned to
-- `public.is_app_user()`, not to `auth.role() = 'authenticated'`. One shared
-- login, no per-person boundary — a person can clear somebody else's spotlight
-- and that is intentional, exactly like every other table here.
alter table spotlights enable row level security;

drop policy if exists spotlights_authenticated on spotlights;
create policy spotlights_authenticated on spotlights
  for all to authenticated using (public.is_app_user()) with check (public.is_app_user());

-- realtime -------------------------------------------------------------------
-- Idempotent: `alter publication ... add table` errors if the table is already
-- a member. Same loop as 0003/0004/0007/0010, with `spotlights` on the end.
-- It maps to the `listings` / `listing(id)` keys in `src/lib/realtime.tsx` (the
-- rows arrive embedded in a listing, like votes and photos), which is what puts
-- somebody else's shout on your Home screen without a refresh.
do $$
declare
  t text;
begin
  foreach t in array array[
    'messages', 'listings', 'votes', 'activity', 'interactions', 'brokers',
    'people', 'listing_photos', 'locations', 'commute_times', 'spotlights'
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

-- merge_listings -------------------------------------------------------------
-- Redefinition of the 0010 function, which is otherwise reproduced verbatim.
-- One change: `spotlights` is repointed at the survivor.
--
-- It is a plain UPDATE rather than the insert/on-conflict/delete dance votes,
-- thread_reads and commute_times need, because the primary key here is
-- `person_id` alone: repointing a row can never collide with another row of the
-- same person, since there is only ever one. Somebody who had spotlighted both
-- halves of a duplicate ends up with one spotlight on the survivor, which is
-- the right answer and the only one the key permits.
--
-- CREATE OR REPLACE rewrites a function's configuration too, so
-- `set search_path = public` is restated here — same reason it is restated in
-- 0004, 0005, 0007, 0008, 0009 and 0010.
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

  -- spotlights (0012): "look at this one" was said about an apartment, not
  -- about a row, so it follows the row that survives.
  update spotlights set listing_id = dst where listing_id = src;

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
-- Same belt and braces as 0004/0005/0007/0008/0009/0010.
alter function merge_listings(uuid, uuid) set search_path = public;
