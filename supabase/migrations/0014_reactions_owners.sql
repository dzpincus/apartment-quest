-- Apartment Quest — message reactions, and follow-ups owned by more than one person
--
-- Applies after 0013. Re-runnable.
--
-- Two unrelated features, one file, because they ship together:
--
-- 1. message_reactions — a face on a message. Four people in one thread do not
--    need a "got it" message; they need a way to say it without one.
-- 2. listings.next_action_owners — "who's on it" stopped being one person.
--    `next_action_owner` (0001) stays and mirrors `next_action_owners[1]`.
-- 3. merge_listings — redefined a NINTH time so the new array survives a merge.

-- ============================================================================
-- 1. message_reactions
-- ============================================================================
-- The primary key is the whole row: one person, one emoji, one message. That
-- makes a toggle a plain insert-or-delete with no read in between, and makes a
-- double-tap on a flaky connection idempotent rather than a second identical
-- row.
--
-- `emoji` is text with a length CHECK rather than an enum: the six in
-- `src/lib/reactions.ts` are a UI palette, not a schema, and a seventh must be
-- a one-line change in a component. 8 characters is room for a ZWJ sequence
-- (👩‍👩‍👧 is 8 code points) without being room for a paragraph.
--
-- Both foreign keys cascade. A deleted message must not leave its reactions
-- behind, and a deleted person's face must not outlive them.
--
-- No `updated_at` and no trigger: a reaction is not edited, it is added or
-- taken away.
create table if not exists message_reactions (
  message_id uuid not null references messages(id) on delete cascade,
  person_id  uuid not null references people(id) on delete cascade,
  emoji      text not null check (char_length(emoji) <= 8),
  created_at timestamptz not null default now(),
  primary key (message_id, person_id, emoji)
);

-- The read is always "every reaction on these messages", which the primary
-- key's leading column already serves. No second index.

-- rls ------------------------------------------------------------------------
-- The 0011 shape: one `for all to authenticated` policy pinned to
-- `public.is_app_user()`, never to `auth.role() = 'authenticated'`. One shared
-- login, no per-person boundary — somebody can remove somebody else's reaction,
-- exactly like every other table here.
alter table message_reactions enable row level security;

drop policy if exists message_reactions_authenticated on message_reactions;
create policy message_reactions_authenticated on message_reactions
  for all to authenticated using (public.is_app_user()) with check (public.is_app_user());

-- realtime -------------------------------------------------------------------
-- Idempotent, same loop as 0003/0004/0007/0010/0012, with `message_reactions`
-- on the end. It maps to the `messages` *prefix* in `src/lib/realtime.tsx`: a
-- reaction row carries no `listing_id`, so there is no way to tell which thread
-- moved, and refreshing a dozen small cache entries is cheaper than a column
-- nobody would otherwise read.
do $$
declare
  t text;
begin
  foreach t in array array[
    'messages', 'listings', 'votes', 'activity', 'interactions', 'brokers',
    'people', 'listing_photos', 'locations', 'commute_times', 'spotlights',
    'message_reactions'
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

-- merge_listings and reactions ------------------------------------------------
-- Nothing to do. `merge_listings` repoints `messages` at the survivor
-- (`update messages set listing_id = dst`), and a reaction hangs off a message
-- *id*, which the merge never changes. The rows follow their message for free.

-- ============================================================================
-- 2. listings.next_action_owners
-- ============================================================================
-- "Who's on it" was one person because the first version of the form had one
-- select on it, not because a follow-up only ever needs one pair of hands:
-- "call the broker and both of us go and look at it" is the normal case, and it
-- had to be typed into the free-text action instead.
--
-- An array column rather than a join table. `listings` is read whole on every
-- page (`LISTING_SELECT`), the cardinality is at most four, and a
-- `listing_next_action_owners` table would be a fifth embed and a fifth thing a
-- merge has to repoint — for a set that is never queried from the other side.
--
-- NOT NULL with a `'{}'` default, so "nobody yet" is an empty array and never a
-- null: `cardinality(null)` is null, and one `coalesce` forgotten anywhere is a
-- row that silently drops out of a filter.
alter table listings
  add column if not exists next_action_owners uuid[] not null default '{}';

-- Backfill: every row that already names an owner keeps it. Guarded on the
-- array being empty so re-running this file cannot undo a later edit that
-- deliberately cleared the owners while the scalar still held one.
update listings
set next_action_owners = array[next_action_owner]
where next_action_owner is not null
  and next_action_owners = '{}';

-- `next_action_owner` is deliberately NOT dropped.
--
-- The array is the truth and the scalar is a mirror of `next_action_owners[1]`,
-- written by the same statement. Three reasons it stays:
--
--   * `LISTING_SELECT` embeds `next_action_owner_person:people!next_action_owner`
--     — a PostgREST embed needs a foreign key, and an array has none. Dropping
--     the column would mean rewriting the read at the same moment as the write.
--   * A browser tab left open across the deploy still writes the scalar. With
--     the column gone that write is a 400; with it there it is harmless.
--   * `listings_next_due` and every existing query keep working unchanged.
--
-- If the mirror is ever removed, that is its own migration, with the embed and
-- the read rewritten in the same commit.

-- ============================================================================
-- 3. merge_listings — ninth definition
-- ============================================================================
-- The 0012 function reproduced verbatim, with one column added to the backfill:
-- `next_action_owners`, treated the way `pets` and the amenities are treated —
-- an empty set is an absence, not an answer, so the survivor takes the
-- duplicate's owners when it has none of its own.
--
-- The scalar mirror is derived from the *same* expression rather than
-- `coalesce`d separately: the whole contract of `next_action_owner` after 0014
-- is "element one of the array", and a merge must not be the one place the two
-- can disagree.
--
-- CREATE OR REPLACE rewrites a function's configuration too, so
-- `set search_path = public` is restated here — same reason it is restated in
-- 0004, 0005, 0007, 0008, 0009, 0010 and 0012.
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

  -- `message_reactions` is not in this list on purpose: it hangs off a message
  -- id, and the messages themselves are repointed on the next line.
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
    -- who's on it (0014): an empty set is an absence, the same arm `pets` gets
    next_action_owners = case
                          when cardinality(d.next_action_owners) = 0
                            then s.next_action_owners
                          else d.next_action_owners
                        end,
    -- ...and the scalar mirror is element one of exactly that expression, not
    -- a separate coalesce that could pick a person who is not in the array
    next_action_owner = (case
                          when cardinality(d.next_action_owners) = 0
                            then s.next_action_owners
                          else d.next_action_owners
                        end)[1],
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
-- Same belt and braces as 0004/0005/0007/0008/0009/0010/0012.
alter function merge_listings(uuid, uuid) set search_path = public;
