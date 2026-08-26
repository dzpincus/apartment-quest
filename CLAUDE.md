@AGENTS.md

# Apartment Quest

Private NYC apartment-hunt tracker for four people. Product spec: `SPEC.md`.
Manual listing entry only — no scraping, no listing-site APIs, no file uploads.

## Stack

- Next.js 16 (App Router, Turbopack) + TypeScript, `src/` dir, pnpm
- Tailwind v4 + shadcn/ui (Base UI under the hood, not Radix)
- Supabase: Postgres + Auth + Realtime (`@supabase/supabase-js`, `@supabase/ssr`)
- TanStack Query for server state, zod + react-hook-form for forms
- date-fns + `@date-fns/tz` for America/New_York rendering
- vitest for pure-logic tests
- Deployed on Vercel

## Setup

```bash
pnpm i
cp .env.example .env.local   # fill in from the Supabase dashboard
pnpm dev                     # http://localhost:3000
```

Env vars (all client-visible, all `NEXT_PUBLIC_`):

| Var | Notes |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon/public key (new-style `sb_publishable_...` also works) |
| `NEXT_PUBLIC_APP_LOGIN_EMAIL` | Identifier for the one shared auth user. Never rendered. |

Missing env does not break `pnpm build` — Supabase clients only throw when
constructed at runtime.

## Database

SQL lives in `supabase/`, applied by hand (no CLI link, no local stack):

- `supabase/migrations/0001_schema.sql` — tables + indexes
- `supabase/migrations/0002_rls.sql` — RLS on every table, one `authenticated` policy each
- `supabase/migrations/0003_rpc_triggers.sql` — `set_updated_at`, `merge_listings`, `unread_counts`, realtime publication
- `supabase/migrations/0004_review_fixes.sql` — `log_interaction`, `mark_thread_read`,
  `merge_listings` redefined (follow-up columns carried across, merged targets
  refused), `brokers` + `people` added to the realtime publication
- `supabase/migrations/0005_pets.sql` — `listings.pets` + `listings.pet_notes`,
  `merge_listings` redefined again (the pet columns carried across, `'unknown'`
  treated as an absence rather than an answer)
- `supabase/seed.sql` — the four people (idempotent)

Apply in filename order via the Supabase SQL editor (paste + run) or the Supabase
MCP `apply_migration` tool. New changes go in a new numbered file; never edit an
applied one.

`merge_listings` is defined three times — 0003 and 0004 are history, 0005 is the
live version.
`CREATE OR REPLACE` rewrites a function's configuration too, so any redefinition
must restate `set search_path = public`.

Deviations from `SPEC.md` are commented in the SQL: `people.key` + `people.annual_income`,
`thread_reads.listing_id` NOT NULL with a separate `global_reads` table, and CHECK
constraints on the enum-ish text columns. One more lives in the UI rather than the
schema: **the person gate is a picker over the seeded rows, not a free-text sign-up.**
`people` is a fixed roster of four written by `seed.sql`, so `PersonProvider` offers
buttons and nothing else — there is no "add me" path, and an empty list is a seeding
problem, which is what the gate says. A failed *fetch* is a different thing and now
says so, with a Retry, rather than pointing at `seed.sql`.

## Commands

```bash
pnpm dev     # dev server
pnpm lint    # eslint
pnpm build   # production build
pnpm test    # vitest run
```

Run `pnpm lint && pnpm build && pnpm test` before every commit.

## Deploy

Vercel, `main` branch. Set the three env vars in the Vercel project settings for
Production and Preview.

## Architectural rules

- **All writes go through `src/lib/mutations.ts`.** Every mutation writes its row
  *and* the matching `activity` row with a pre-rendered `summary` string. No
  component calls `supabase.from(...).insert/update/delete` directly. Reads go
  through `src/lib/queries.ts` (key factory + fetchers + `use*` hooks); later
  phases add their verbs to `mutations.ts` and nowhere else.
- **Summaries are verb phrases without the actor's name** ("added 214 Grand St
  #4B"): the feed prints the person with their colour, so the name would double up.
  `updateListing` only logs when a meaningful column changed — `updated_at`,
  `last_contacted_at` and `next_action*` are excluded, since those belong to
  phase 3's own verbs.
- **Dedupe**: `dedupeKey(address, unit)` in `src/lib/dedupe.ts` mirrors the
  Postgres generated column byte for byte
  (`lower(regexp_replace(address||'|'||unit, '[^a-zA-Z0-9|]', '', 'g'))`). Change
  one and you must change the other. The add form checks it on blur and again on
  submit; post-hoc dupes use the `merge_listings` RPC from the detail page.
- **`pets` defaults to `'unknown'`, which is an absence, not an answer.** The
  column is never null on new rows, so the merge backfill cannot use a plain
  `coalesce`: `merge_listings` (0005) takes the source's policy whenever the
  target's is `'unknown'`, and `blankForMerge` in `mutations.ts` mirrors that
  for the add-form's "merge into it" path. Change one and change the other.
  Reads treat null (pre-0005 rows) and `'unknown'` the same — filter, sort,
  select and chip all resolve `pets ?? "unknown"`.
- **Qualification math**: `required = rent * income_multiplier` — NYC 40x means
  combined *annual* income >= 40x *monthly* rent. `SPEC.md` writes
  `rent * 12 * income_multiplier`, which applies the 40x twice; the convention it
  cites wins over its own formula. Documented in `qualification()`.
- **`person_id` comes from `usePerson()`** (`src/lib/person.tsx`), never from a prop
  drill or a fresh localStorage read, and is passed explicitly into every
  `mutations.ts` call (`useMutations(person?.id)`).
- **Two gates**: real Supabase auth (guarded server-side in `src/proxy.ts` — Next 16's
  renamed `middleware.ts`) then the person picker. The login email is an internal
  identifier and must never be rendered.
- **Follow-up queue**: bucketing lives in `src/lib/queue.ts` and is pure —
  `bucketListings(rows, { todayNY, now })` takes the clock as an argument so the
  boundaries are testable (`src/lib/queue.test.ts`). Buckets: overdue
  (`next_action_due < today`), today (`= today`), cold (`status = 'contacted'`,
  `last_contacted_at` older than 24h, no `next_action`). Merged rows and
  `passed` / `lost` are excluded, a listing lands in at most one bucket, and any
  due date at all keeps a listing out of Cold. `setListingStatus` to passed/lost
  nulls the follow-up triple so dead listings leave the queue. Home and the nav
  badge share one cache entry (`useQueueListings` reuses `queryKeys.listings`),
  so the badge costs no extra request.
- **The next-action prompt is not skippable.** Step 2 of `LogContactDialog` has
  no close button, ignores Escape and outside clicks (controlled `open` +
  `disablePointerDismissal`, same trick as the person gate). The only exits are
  a next action or marking the listing Passed / Lost. SPEC: "If it is skippable,
  everything rots." `logInteraction` also bumps `last_contacted_at` and moves a
  still-`saved` listing to `contacted` without writing a second
  `changed_status` row — one contact is one impression. All three writes are one
  `log_interaction` RPC (0004), so a dropped connection cannot leave a listing
  `contacted` with no history; the failure path stays on step 1 rather than
  advancing into the prompt it cannot dismiss.
- **`mutateAsync` is always wrapped.** `onError` fires the toast, so the `catch`
  is empty and only guards what comes *after* the await — the success toast, the
  `onDone()`, the `router.push`. An unwrapped `mutateAsync` is both an unhandled
  rejection and a UI that pretends the write worked. Fire-and-forget writes use
  `.mutate` instead.
- **Server clock for anything the buckets or badges compare.** `log_interaction`
  and `mark_thread_read` stamp `now()` in Postgres, the same clock
  `messages.created_at` comes from. A device running fast used to mark messages
  read before they were written. `useQueue` is the mirror image: it holds `now`
  in state and ticks it every 60s, because the buckets are boundaries in time
  and a tab left open froze on the day it was mounted.
- **Realtime is invalidation only.** `RealtimeProvider` (`src/lib/realtime.tsx`) is
  mounted once in `(app)/layout.tsx` inside the QueryClientProvider and opens a
  single channel (`app`) listening to `postgres_changes` on messages, listings,
  votes, activity and interactions. Payload rows decide *which* query key to
  invalidate and are never written into the cache — realtime payloads are flat
  table rows, so putting one in a cache entry would drop the embedded `person` /
  `broker` joins. Invalidations are debounced 150ms so a burst of related rows
  (a message plus its activity row) costs one refetch. No manual
  `supabase.realtime.setAuth()`: `createBrowserClient` gives realtime-js an
  `accessToken` callback that it calls on connect and before each subscribe, so
  the socket already carries the session JWT for the per-subscriber RLS check.
  `setAuth` would only be needed for private Broadcast/Presence channels.
- **Threads**: `<Thread listingId={null} />` is the global chat, `listingId={id}`
  a listing's. Reading is an observation, not an impression, so `markThreadRead`
  writes `thread_reads` / `global_reads` and *no* activity row, and it only fires
  while `document.visibilityState === "visible"` — a background tab must not
  clear a badge nobody saw. It also does not invalidate the thread it just read
  (only `["unread"]`), which is what keeps an open thread out of a refetch loop.
  `postMessage` marks the thread read for the author. Badges come from the
  `unread_counts` RPC through `useUnread()`, keyed by person.
- **Votes ride on the listing row.** `LISTING_SELECT` embeds
  `votes(person_id, vote, comment, updated_at)`, so the table chips, the mobile
  cards and the detail widget all read votes from a query that already runs —
  no per-listing vote fetch, no N+1. `useVotes(id)` is `useListing(id)` with a
  `select`, i.e. the same cache entry. `castVote` / `clearVote` are the app's
  only optimistic writes (three buttons that wait for a round trip feel broken):
  `onMutate` patches `listings` *and* `listings/{id}`, `onError` restores the
  snapshot, `onSettled` invalidates. Summary wording depends on the `prev` vote
  passed in — "voted yes on X" / "changed vote to maybe on X" / "commented on
  their vote for X" / "withdrew vote on X" — and a comment blur that changed
  nothing writes no activity row at all. Pure helpers (counts, the `voteScore`
  the Votes column sorts by, the "my vote" filter, the cache patches) live in
  `src/lib/votes.ts` with tests; colours live once in `VOTE_TONE`
  (`vote-chips.tsx`). Only your own row in `VotesCard` is interactive, which is
  a guard rail and not a permission — one shared login, no boundary.
- **Time**: store UTC, render New York. Use `fmtNY` / `todayNY` from `src/lib/time.ts`;
  never `new Date().toLocaleString()` and never compare dates in local time.
- **Mobile-first**: bottom tab bar under `md`, top bar at `md` and up.
- Types in `src/lib/types.ts` are hand-written and must be updated alongside any
  schema migration.
- There is no per-person security boundary. One shared login, everyone sees and
  edits everything. Intentional.
