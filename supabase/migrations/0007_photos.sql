-- Apartment Quest — listing photos
--
-- Applies after 0006 (or 0005 — nothing here depends on the sync columns).
-- Re-runnable.
--
-- 1. listing_photos — one row per stored image, main + thumbnail.
-- 2. storage: a public `listing-photos` bucket and the three object policies.
-- 3. merge_listings — redefined so a duplicate's photos follow the survivor.
-- 4. realtime — listing_photos joins the publication.

-- table ----------------------------------------------------------------------
-- `storage_path` / `thumb_path` are paths *inside* the bucket
-- (`<listing_id>/<uuid>.webp`), never full URLs: the project ref lives in
-- NEXT_PUBLIC_SUPABASE_URL and moving projects must not mean rewriting rows.
-- `photoUrl()` in `src/lib/photos-client.ts` is the only place they become URLs.
--
-- `source_url` is null for a manual upload and the original CDN link for an
-- imported one — kept for provenance, never fetched again.
--
-- on delete cascade: deleting a listing takes its photo rows with it. The
-- objects in storage are *not* cascaded (Postgres cannot reach them); the app
-- never hard-deletes a listing, so this is a note rather than a leak.
create table if not exists listing_photos (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references listings(id) on delete cascade,
  storage_path text not null,
  thumb_path text not null,
  source_url text,
  width int,
  height int,
  bytes int,
  sort int not null default 0,
  added_by uuid references people(id),
  created_at timestamptz default now()
);

-- Every read is "this listing's photos, in order", so the index is the query.
create index if not exists listing_photos_listing on listing_photos (listing_id, sort);

-- rls ------------------------------------------------------------------------
-- Same shape as every other table (0002): one shared login, no per-person
-- boundary. `drop policy if exists` first so this file can be re-applied.
alter table listing_photos enable row level security;

drop policy if exists listing_photos_authenticated on listing_photos;

create policy listing_photos_authenticated on listing_photos
  for all to authenticated using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- storage bucket -------------------------------------------------------------
-- Public read: the paths carry a random uuid, the images are pictures of
-- apartments that are already on the public internet, and a public bucket means
-- a plain <img src> with no signing round trip on every thumbnail.
--
-- 8MB and the three mime types are a second wall behind the route's own caps —
-- the route is the only writer today, but the policies below would let an
-- authenticated client upload directly, and this keeps that door narrow.
--
-- `do nothing` on conflict: an existing bucket keeps whatever limits it has
-- rather than being silently re-configured by a re-run.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('listing-photos', 'listing-photos', true, 8388608,
        array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

drop policy if exists "photos public read" on storage.objects;
drop policy if exists "photos auth write" on storage.objects;
drop policy if exists "photos auth delete" on storage.objects;

create policy "photos public read" on storage.objects
  for select using (bucket_id = 'listing-photos');
create policy "photos auth write" on storage.objects
  for insert to authenticated with check (bucket_id = 'listing-photos');
create policy "photos auth delete" on storage.objects
  for delete to authenticated using (bucket_id = 'listing-photos');

-- merge_listings -------------------------------------------------------------
-- Redefinition of the 0005 function, which is otherwise reproduced verbatim.
-- The only change is one line: a duplicate's photos are repointed at the
-- survivor alongside its interactions and messages, so merging two copies of
-- the same apartment gathers both sets of pictures instead of stranding one on
-- a row nothing links to.
--
-- Sort values are carried across as-is. Two photos can therefore share a `sort`
-- on the survivor; the client orders by `(sort, id)`, so the result is stable
-- rather than merely arbitrary.
--
-- CREATE OR REPLACE rewrites the function's configuration too, so the
-- `set search_path = public` from 0004/0005 has to be restated here.
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
    next_action_owner = coalesce(d.next_action_owner, s.next_action_owner)
  from listings s
  where d.id = dst and s.id = src;

  update listings set merged_into = dst where id = src;
end;
$$;

-- search_path hardening ------------------------------------------------------
-- Same belt and braces as 0004/0005.
alter function merge_listings(uuid, uuid) set search_path = public;

-- realtime -------------------------------------------------------------------
-- Idempotent: `alter publication ... add table` errors if the table is already
-- a member. Same loop as 0003/0004, with listing_photos on the end — a photo
-- saved by the import route lands on the detail page without a refresh.
do $$
declare
  t text;
begin
  foreach t in array array[
    'messages', 'listings', 'votes', 'activity', 'interactions', 'brokers',
    'people', 'listing_photos'
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
