-- Apartment Quest — pet policy
--
-- Applies after 0004. Re-runnable.
--
-- 1. listings.pets / listings.pet_notes — "can we bring the cat" as a column
--    rather than a sentence buried in `notes`, so it can be filtered on.
-- 2. merge_listings — redefined so the two new columns survive a merge.

-- columns --------------------------------------------------------------------
-- `unknown` is the default for the same reason `fee_type` uses one: a listing
-- nobody has asked about yet is not the same as a listing that said no, and a
-- nullable tri-state would have the UI writing `?? 'unknown'` at every read.
-- The CHECK mirrors `PetsPolicy` in `src/lib/types.ts` — keep them in step.
alter table listings
  add column if not exists pets text default 'unknown'
    check (pets in ('yes', 'cats_only', 'dogs_only', 'no', 'unknown'));

-- Free text for the fine print: weight limits, deposits, "dogs but not pit
-- bulls". Nullable — most listings will never have one.
alter table listings
  add column if not exists pet_notes text;

-- merge_listings -------------------------------------------------------------
-- Redefinition of the 0004 function, which is otherwise reproduced verbatim.
-- The only change is the two new columns in the backfill:
--
--   * `pets` is not coalesced like the other columns, because its default is
--     `'unknown'` rather than null — a plain `coalesce` would treat "nobody has
--     asked yet" as an answer and drop `src`'s real one. Any non-unknown value
--     on `dst` wins; otherwise `src`'s is adopted.
--   * `pet_notes` is a normal nullable column, so a plain coalesce is right.
--
-- CREATE OR REPLACE rewrites the function's configuration too, so the
-- `set search_path = public` from 0004 has to be restated here.
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

  update interactions set listing_id = dst where listing_id = src;
  update messages     set listing_id = dst where listing_id = src;

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
    next_action_owner = coalesce(d.next_action_owner, s.next_action_owner)
  from listings s
  where d.id = dst and s.id = src;

  update listings set merged_into = dst where id = src;
end;
$$;

-- search_path hardening ------------------------------------------------------
-- Same belt and braces as 0004.
alter function merge_listings(uuid, uuid) set search_path = public;
