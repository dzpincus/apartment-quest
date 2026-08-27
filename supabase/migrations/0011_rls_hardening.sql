-- Apartment Quest — RLS hardening: pin every policy to one auth user.
--
-- WHAT THIS CHANGES
-- Every policy in this project has been `auth.role() = 'authenticated'` since
-- 0002 — i.e. "any session Supabase will issue". That is the right shape for a
-- one-shared-login app *provided* only one login can ever exist, which is a
-- dashboard setting (signups off, anonymous sign-ins off) and therefore a
-- checkbox someone can un-tick. If either is ever flipped on, `auth.role() =
-- 'authenticated'` reads the whole database to a stranger. This migration
-- replaces that test with `public.is_app_user()`, which is true only for the
-- one uid you nominate. Defence in depth: the checkboxes stay off, and the
-- database stops depending on them.
--
-- APPLY THIS, THEN RUN `supabase/owner.sql.example` OR THE APP GOES DARK.
-- Until `app_config` holds an `owner_uid` row, `is_app_user()` is false for
-- everybody and every table reads empty. That is deliberate — it fails closed —
-- but it means the two steps belong in the same sitting. Copy the uid out of
-- the Supabase dashboard (Authentication → Users → your one user → User UID).
--
-- WHY A TABLE AND NOT A SETTING
-- The obvious implementation is a custom GUC — `alter database postgres set
-- app.owner_uid = '…'` and `current_setting('app.owner_uid', true)` — which
-- keeps the uid out of the repo for free. Supabase's managed Postgres refuses
-- it: the `postgres` role is not a superuser there and `alter database … set`
-- comes back `42501: permission denied`. So the uid lives in a one-row table
-- instead. `app_config` has RLS enabled and **no policies at all**, which in
-- Postgres means "deny everything", and its grants are revoked from `anon` and
-- `authenticated` on top of that. Nothing holding the anon key can read it.
-- `is_app_user()` is `security definer`, so it runs as the function's owner —
-- the table's owner, which bypasses RLS — and `stable`, so the planner
-- evaluates it once per statement rather than once per row.
--
-- The uid itself is not a secret (it is in every JWT the browser holds), but it
-- is deployment-specific, so it is data rather than a committed constant. A
-- fork gets its own.
--
-- WHY PHOTOS KEEP WORKING
-- `listing-photos` is a *public* bucket (0007) and Supabase's public-object
-- endpoint — `/storage/v1/object/public/<bucket>/<path>`, which is what
-- `photoUrl()` in `src/lib/photos-client.ts` builds — serves objects without
-- consulting RLS at all. Tightening `"photos public read"` therefore changes
-- nothing about `<img src>`; what it closes is the *authenticated* listing and
-- download API, where a session that is not ours could otherwise enumerate the
-- bucket. Making the bucket private is a different and much larger change (a
-- signed URL per thumbnail, a round trip per row) and is not this migration.
--
-- Re-runnable: `create ... if not exists`, `create or replace`, and every
-- policy dropped before it is created.

-- 1. where the uid lives ------------------------------------------------------
create table if not exists public.app_config (
  key   text primary key,
  value text not null
);

-- RLS on with zero policies = no row is visible to any role that does not
-- bypass RLS. The revokes are the belt to that suspenders: even a future
-- `grant all on all tables in schema public` would not re-open it.
alter table public.app_config enable row level security;

revoke all on public.app_config from anon, authenticated;

-- 2. the test ----------------------------------------------------------------
-- Fails closed in all three ways it can be asked wrongly:
--   * no JWT at all    -> auth.uid() is null, so the first conjunct is false.
--   * an anonymous JWT -> auth.uid() is NOT null (an anonymous sign-in is a
--                         real row in auth.users), so the *second* conjunct is
--                         what refuses it: a uid that is not the owner's.
--                         This is the case the whole migration exists for.
--   * no owner_uid row -> the subquery yields null, `=` yields null, and a
--                         USING clause treats null as false.
-- Note the third case is null rather than false, which is the same answer for
-- a policy but not for a bare `select public.is_app_user()`.
create or replace function public.is_app_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
     and auth.uid()::text = (select value from public.app_config where key = 'owner_uid')
$$;

-- The function reads a table nobody else may read, so its execute bit is the
-- door: hand it to the two roles that appear in policies and nobody else.
revoke all on function public.is_app_user() from public;
grant execute on function public.is_app_user() to authenticated, anon;

-- 3. the tables ---------------------------------------------------------------
-- Every `_authenticated` policy from 0002, 0007 and 0010, redefined against the
-- new test. Same names, same `for all to authenticated` shape — the only change
-- is what the predicate asks.
drop policy if exists people_authenticated on people;
create policy people_authenticated on people
  for all to authenticated using (public.is_app_user()) with check (public.is_app_user());

drop policy if exists brokers_authenticated on brokers;
create policy brokers_authenticated on brokers
  for all to authenticated using (public.is_app_user()) with check (public.is_app_user());

drop policy if exists listings_authenticated on listings;
create policy listings_authenticated on listings
  for all to authenticated using (public.is_app_user()) with check (public.is_app_user());

drop policy if exists interactions_authenticated on interactions;
create policy interactions_authenticated on interactions
  for all to authenticated using (public.is_app_user()) with check (public.is_app_user());

drop policy if exists votes_authenticated on votes;
create policy votes_authenticated on votes
  for all to authenticated using (public.is_app_user()) with check (public.is_app_user());

drop policy if exists messages_authenticated on messages;
create policy messages_authenticated on messages
  for all to authenticated using (public.is_app_user()) with check (public.is_app_user());

drop policy if exists thread_reads_authenticated on thread_reads;
create policy thread_reads_authenticated on thread_reads
  for all to authenticated using (public.is_app_user()) with check (public.is_app_user());

drop policy if exists global_reads_authenticated on global_reads;
create policy global_reads_authenticated on global_reads
  for all to authenticated using (public.is_app_user()) with check (public.is_app_user());

drop policy if exists activity_authenticated on activity;
create policy activity_authenticated on activity
  for all to authenticated using (public.is_app_user()) with check (public.is_app_user());

drop policy if exists documents_authenticated on documents;
create policy documents_authenticated on documents
  for all to authenticated using (public.is_app_user()) with check (public.is_app_user());

drop policy if exists doc_shares_authenticated on doc_shares;
create policy doc_shares_authenticated on doc_shares
  for all to authenticated using (public.is_app_user()) with check (public.is_app_user());

drop policy if exists listing_photos_authenticated on listing_photos;
create policy listing_photos_authenticated on listing_photos
  for all to authenticated using (public.is_app_user()) with check (public.is_app_user());

drop policy if exists locations_authenticated on locations;
create policy locations_authenticated on locations
  for all to authenticated using (public.is_app_user()) with check (public.is_app_user());

drop policy if exists commute_times_authenticated on commute_times;
create policy commute_times_authenticated on commute_times
  for all to authenticated using (public.is_app_user()) with check (public.is_app_user());

-- 4. storage ------------------------------------------------------------------
-- 0007's three policies, same names, now pinned. Note the read policy changes
-- role too: it was unqualified (every role, including `anon`) and is now
-- `to authenticated` *and* pinned. See the header — the public-object endpoint
-- does not consult RLS, so thumbnails are unaffected; this is about the
-- authenticated storage API.
drop policy if exists "photos public read" on storage.objects;
create policy "photos public read" on storage.objects
  for select to authenticated
  using (bucket_id = 'listing-photos' and public.is_app_user());

drop policy if exists "photos auth write" on storage.objects;
create policy "photos auth write" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'listing-photos' and public.is_app_user());

drop policy if exists "photos auth delete" on storage.objects;
create policy "photos auth delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'listing-photos' and public.is_app_user());

-- The service-role client (`src/lib/supabase/admin.ts`) bypasses every policy
-- above, which is why `/api/photos`, `/api/sync`, `/api/geocode` and
-- `/api/commutes` are unaffected by all of this. They do their own auth: a
-- session check, or `CRON_SECRET` compared with `timingSafeEqual`.
