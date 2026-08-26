-- Apartment Quest — code-review fixes
--
-- Applies after 0003. 0003 stays as history: the functions below are the
-- current definitions and win. Everything here is re-runnable.
--
-- 1. log_interaction   — one transaction instead of three client round trips
-- 2. mark_thread_read  — read markers stamped by the server clock, not the browser's
-- 3. merge_listings    — carries the follow-up columns across, refuses a merged target
-- 4. realtime          — brokers and people join the publication

-- log_interaction ------------------------------------------------------------
-- "Log contact" used to be three separate writes from the client: insert the
-- interaction, bump `last_contacted_at`, move a still-`saved` listing to
-- `contacted`. A dropped connection between them left the listing contacted
-- with no history, or an interaction that never bumped the cold-bucket clock.
--
-- One plpgsql call is one transaction, so it is all or nothing. The implicit
-- saved -> contacted move still writes no `changed_status` activity row — one
-- contact is one impression — and the caller logs `logged_interaction` itself.
create or replace function log_interaction(
  p_person uuid,
  p_listing uuid,
  p_kind text,
  p_notes text
)
returns interactions
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row interactions;
begin
  insert into interactions (listing_id, person_id, kind, notes)
  values (p_listing, p_person, p_kind, nullif(btrim(coalesce(p_notes, '')), ''))
  returning * into v_row;

  update listings
  set last_contacted_at = now(),
      status = case
                 when coalesce(status, 'saved') = 'saved' then 'contacted'
                 else status
               end
  where id = p_listing;

  if not found then
    raise exception 'listing % does not exist', p_listing;
  end if;

  return v_row;
end;
$$;

-- mark_thread_read -----------------------------------------------------------
-- The browser used to supply `last_read_at`, so a device with a fast clock
-- could mark messages read before they were written and silently hide them.
-- `now()` here is the same clock `messages.created_at` is stamped from.
--
-- `p_listing null` is the global thread, which lives in its own table:
-- `thread_reads.listing_id` is part of the primary key and Postgres will not
-- enforce uniqueness over a null.
create or replace function mark_thread_read(p_person uuid, p_listing uuid default null)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_listing is null then
    insert into global_reads (person_id, last_read_at)
    values (p_person, now())
    on conflict (person_id) do update set last_read_at = now();
  else
    insert into thread_reads (person_id, listing_id, last_read_at)
    values (p_person, p_listing, now())
    on conflict (person_id, listing_id) do update set last_read_at = now();
  end if;
end;
$$;

-- merge_listings -------------------------------------------------------------
-- Redefinition of the 0003 function. Two fixes:
--
--   * the backfill skipped the follow-up columns, so folding a chased listing
--     into an untouched one dropped `last_contacted_at` and the whole
--     `next_action` triple — the merged row fell out of the queue entirely;
--   * merging into a row that is itself merged built a chain the app never
--     follows (the detail banner links one hop), stranding the history.
--
-- `last_contacted_at` takes the later of the two rather than coalescing: both
-- sides may have been contacted and the cold bucket wants the most recent.
-- The follow-up triple is coalesced as a unit — `dst`'s plan wins if it has
-- one, otherwise `src`'s is adopted whole, so action/due/owner never mix.
--
-- CREATE OR REPLACE rewrites the function's configuration too, so the
-- `set search_path = public` from 0003 has to be restated here.
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

-- realtime -------------------------------------------------------------------
-- `brokers` and `people` were missing: renaming a broker or a person changed
-- rows that ride embedded on every listing, and no other device heard about
-- it until something else forced a refetch.
--
-- Idempotent, same DO-loop as 0003: `alter publication ... add table` errors if
-- the table is already a member.
do $$
declare
  t text;
begin
  foreach t in array array[
    'messages', 'listings', 'votes', 'activity', 'interactions', 'brokers', 'people'
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

-- search_path hardening ------------------------------------------------------
-- Belt and braces: the definitions above already pin it, this keeps the
-- Supabase linter quiet if either is ever edited without the SET clause.
alter function log_interaction(uuid, uuid, text, text) set search_path = public;
alter function mark_thread_read(uuid, uuid) set search_path = public;
alter function merge_listings(uuid, uuid) set search_path = public;
