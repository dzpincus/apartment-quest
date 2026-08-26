-- Apartment Quest — the sync columns survive a merge
--
-- Applies after 0007 (and after 0006, whose columns this reads). Re-runnable.
-- No schema change: one function, redefined.
--
-- The bug. `merge_listings` backfills the survivor from the duplicate for
-- every column that matters, and 0006 added three it has never known about:
-- `listing_state`, `state_checked_at` and `state_note`. So merging the copy of
-- a listing that the sync had already found `off_market` into a freshly-added
-- duplicate threw the evidence away — the survivor kept its default `unknown`,
-- the row dropped out of the Vanished section on Home, and the only trace that
-- anything had ever looked at that apartment was an activity line pointing at
-- a listing that now says nothing.
--
-- The rules, matching how each column is read:
--
--   listing_state    'unknown' is an absence, not an answer — exactly the
--                    treatment `pets` gets in 0005. A survivor that knows
--                    nothing takes the duplicate's state; a survivor with a
--                    real state keeps it (the merge target is the row a human
--                    is looking at, and its own state is the fresher claim).
--   state_checked_at greatest(): the last time *anybody* looked at this
--                    apartment is the honest answer, and it is what the sync
--                    queue orders by. coalesce() would let a merge silently
--                    move a listing to the front or the back of the queue.
--   state_note       coalesce(): the evidence beside the state. The survivor's
--                    own note wins, so the note and the state cannot disagree.
--
-- Everything else below is 0007 reproduced verbatim. CREATE OR REPLACE rewrites
-- a function's configuration too, so `set search_path = public` is restated
-- here — same reason it is restated in 0004, 0005 and 0007.
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
-- Same belt and braces as 0004/0005/0007.
alter function merge_listings(uuid, uuid) set search_path = public;
