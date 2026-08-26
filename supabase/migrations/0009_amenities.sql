-- Apartment Quest — amenities as first-class columns
--
-- Applies after 0008. Re-runnable.
--
-- 1. listings.laundry / dishwasher / ac / outdoor_space — the four questions
--    that actually decide whether anyone wants to see an apartment, lifted out
--    of `notes` so they can be filtered, sorted and merged like `pets` (0005)
--    rather than grepped out of a sentence.
-- 2. merge_listings — redefined so the four new columns survive a merge.

-- columns --------------------------------------------------------------------
-- Every one of them defaults to `'unknown'`, for the same reason `pets` and
-- `fee_type` do: a listing nobody has asked about is not a listing that said
-- no, and a nullable tri-state would have the UI writing `?? 'unknown'` at
-- every read. The CHECKs mirror `LaundryPolicy` / `DishwasherPolicy` /
-- `AcPolicy` / `OutdoorSpacePolicy` in `src/lib/types.ts` — keep them in step.

alter table listings
  add column if not exists laundry text default 'unknown'
    check (laundry in ('in_unit', 'in_building', 'none', 'unknown'));

alter table listings
  add column if not exists dishwasher text default 'unknown'
    check (dishwasher in ('yes', 'no', 'unknown'));

alter table listings
  add column if not exists ac text default 'unknown'
    check (ac in ('central', 'window', 'none', 'unknown'));

alter table listings
  add column if not exists outdoor_space text default 'unknown'
    check (outdoor_space in ('private', 'shared', 'none', 'unknown'));

-- merge_listings -------------------------------------------------------------
-- Redefinition of the 0008 function, which is otherwise reproduced verbatim.
-- The only change is the four amenity columns in the backfill, each treated
-- exactly the way `pets` is: `'unknown'` is an absence, not an answer, so a
-- plain `coalesce` would read the default as a real value, refuse to take the
-- duplicate's answer, and leave the survivor saying "nobody asked" about a
-- laundry room somebody had already written down.
--
-- CREATE OR REPLACE rewrites a function's configuration too, so
-- `set search_path = public` is restated here — same reason it is restated in
-- 0004, 0005, 0007 and 0008.
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
    state_note        = coalesce(d.state_note, s.state_note)
  from listings s
  where d.id = dst and s.id = src;

  update listings set merged_into = dst where id = src;
end;
$$;

-- search_path hardening ------------------------------------------------------
-- Same belt and braces as 0004/0005/0007/0008.
alter function merge_listings(uuid, uuid) set search_path = public;
