-- Apartment Quest — listing status sync
--
-- Numbering note: this file applies AFTER 0007_photos.sql. Photos shipped
-- first and took the next number; 0006 was the free slot left behind, and the
-- name is kept so the sync migration sorts next to the plan that describes it.
-- Nothing here depends on 0007 and nothing in 0007 depends on this, so the
-- order is a formality — but this is the one that has not run yet.
--
-- Re-runnable.
--
-- 1. listings.listing_state / state_checked_at / state_note — what the source
--    page said last time we looked, and when.
-- 2. the partial index the sync run orders by.
-- 3. Quest Bot — the system actor, because `activity.person_id` is NOT NULL
--    and a cron run has no person behind it.
-- 4. pg_cron + pg_net, the two extensions the schedules need.
--
-- The schedules themselves are deliberately NOT in this file: they embed the
-- deployment URL and CRON_SECRET, which do not belong in the repo. See
-- `supabase/cron.sql.example` — the same statements with the secrets left as
-- placeholders, applied by hand (Supabase MCP `execute_sql`) once per project.

-- columns --------------------------------------------------------------------
-- `listing_state` is what the *listing site* says, and is never the same thing
-- as `status`, which is what *we* decided. A page that disappeared does not
-- make a listing "lost" — a human does that, from the Vanished? section on
-- Home. Nothing in the app ever writes `status` from a sync run.
--
-- `unknown` is the default and means "nobody has looked yet", exactly like
-- `pets` in 0005: a listing with no URL stays `unknown` forever and that is
-- correct, not missing data. The CHECK mirrors `ListingState` in
-- `src/lib/types.ts` — keep them in step.
alter table listings
  add column if not exists listing_state text default 'unknown'
    check (listing_state in ('active', 'off_market', 'removed', 'unknown'));

-- When the last check ran, whatever its outcome. Bumped even when the site
-- blocked us, so a wall does not turn into a retry loop that never advances.
alter table listings
  add column if not exists state_checked_at timestamptz;

-- The evidence, in the words of the page: "streeteasy.com: no longer
-- available". A note beginning with `blocked` is the one value the app reads
-- rather than prints — it suppresses the paid Firecrawl rung for three days
-- (src/app/api/sync/route.ts) and tells the detail page to say "last check
-- blocked" instead of showing a stale state as fact.
alter table listings
  add column if not exists state_note text;

-- The sync run's own query, as an index: linked, live listings, oldest check
-- first. Partial, because a listing with no URL can never be checked and a
-- merged one is not worth checking.
create index if not exists listings_sync on listings (state_checked_at)
  where url is not null and merged_into is null;

-- system actor ---------------------------------------------------------------
-- `activity.person_id` is NOT NULL, so the cron needs a row of its own to sign
-- with. `#8ed8ff` is the "quiet" token from the Dusk Candy palette — the one
-- colour deliberately not in the roster, so the bot can never be mistaken for
-- a housemate in the feed.
--
-- It is a person row, so `usePeople()` returns it: `isBot()` in
-- `src/lib/people.ts` is what keeps it out of the picker, the incomes list,
-- the votes rows and the qualification sum. Income 0 so that even a missed
-- filter cannot move the 40x math.
insert into people (key, name, color, annual_income)
values ('bot', 'Quest Bot', '#8ed8ff', 0)
on conflict (key) do nothing;

-- extensions -----------------------------------------------------------------
-- pg_cron schedules the run; pg_net makes the outbound HTTP call. Both live in
-- the `extensions` schema on Supabase and both are free on every tier. Vercel
-- Hobby crons are once-a-day and UTC-only, which cannot express "midnight and
-- noon in New York all year"; four UTC jobs plus an hour gate in the route
-- can. See CLAUDE.md → "Sync".
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- realtime: `listings` has been in the publication since 0003, so a state
-- change written by the cron reaches an open tab on its own. No change needed.
