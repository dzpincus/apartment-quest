@AGENTS.md

# Apartment Quest

Private NYC apartment-hunt tracker for four people. Product spec: `SPEC.md`.
Listings are typed in by hand or **imported from a listing URL** (see "Listing
import" below). No listing-site APIs, no headless browser, no file uploads.

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

Server-only vars (never `NEXT_PUBLIC_`, never read from a client component):

| Var | Notes |
|---|---|
| `ANTHROPIC_API_KEY` | Listing import. Missing -> `/api/import` returns 503 `{disabled:true}` and the panel says import isn't configured. Nothing else breaks. |
| `FIRECRAWL_API_KEY` | Optional. Rung two of the import ladder. Missing -> the ladder drops straight to the paste box. |
| `SUPABASE_SERVICE_ROLE_KEY` | Photos. Read only by `src/lib/supabase/admin.ts` (which imports `server-only`). Missing -> `/api/photos` returns 500 and photos cannot be saved; nothing else breaks. |

Missing env does not break `pnpm build` — Supabase clients only throw when
constructed at runtime, and the import route reads its key inside the request.

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
- `supabase/migrations/0007_photos.sql` — `listing_photos` + the public
  `listing-photos` storage bucket and its three `storage.objects` policies,
  `merge_listings` redefined once more (a duplicate's photos follow the
  survivor), `listing_photos` added to the realtime publication
- `supabase/seed.sql` — the four people (idempotent)

Apply in filename order via the Supabase SQL editor (paste + run) or the Supabase
MCP `apply_migration` tool. New changes go in a new numbered file; never edit an
applied one.

`merge_listings` is defined four times — 0003, 0004 and 0005 are history, 0007 is
the live version.
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

Vercel, `main` branch. Set the client vars *and* the server-only ones from the
two tables above in the Vercel project settings, for Production and Preview.

## Listing import

`POST /api/import` takes `{ url }` or `{ text }` and hands back a filled-in
add-listing form. Everything server-side lives in `src/lib/import/`.

**The ladder.** Zillow and StreetEasy run PerimeterX-style bot walls and a
bare fetch from a datacentre IP is often a captcha, so there are three rungs
and the last one always works:

1. `fetch-page.ts` — direct fetch, Chrome UA, 8s, 2MB cap, ≤3 redirects.
2. `firecrawl.ts` — only if `FIRECRAWL_API_KEY` is set *and* rung 1 came back
   blocked. Free tier is 500 credits, so it is never the first attempt.
3. Paste. The response is `{ blocked: true, reason }` — a **200**, not a 500 —
   and the panel swaps in a textarea. `{ text }` skips straight to extraction.

**A site refusing us is not an error.** The route never 500s on a block, a
captcha, a timeout or a JavaScript-only shell; each of those is a `blocked`
result with a sentence a human can act on.

**Extraction is one forced tool call.** `extract.ts` sends the reduced page to
`claude-haiku-4-5-20251001` with `tool_choice: { type: "tool", name:
"record_listing" }`, so the model cannot reply with prose. `reduce.ts` (pure,
tested) shrinks the page to ~30k chars first: JSON-LD, `og:`/`twitter:` meta,
`__NEXT_DATA__` leaves whose keys look like rent/beds/address, then visible
text. `coerce.ts` (pure, tested) re-checks every value the model returns —
rent outside $200-$50,000 is a yearly figure and gets dropped with a warning,
enums fall back to absent rather than wrong, `"N/A"` is an absence, and a unit
left on the end of the address is split off. **Nothing the model says is
trusted.**

**Cost**: ~10k input tokens per import on Haiku, i.e. cents per hundred
imports. Every call logs `input_tokens` / `output_tokens` via `console.info`.

**SSRF**: `assertSafeUrl` allows http(s) only, no credentials, ports 80/443,
and resolves the host — rejecting loopback, private, CGNAT, link-local
(`169.254.169.254`), ULA and multicast. `redirect: "manual"`, re-checked every
hop. Unit-tested in `fetch-page.test.ts`; `vitest.config.mts` aliases
`server-only` so those tests can run.

**Auth**: the route calls `getUser()` and 401s without a session, so the anon
key alone cannot spend tokens. `src/proxy.ts` also answers signed-out `/api/*`
requests with a JSON 401 instead of redirecting a `fetch` to an HTML login page.

**In the UI**: `ImportPanel` sits at the top of the Add Listing dialog, above
the `<form>` element (not inside it — a stray Enter or a nested button would
submit the listing). Imported values **fill blanks only**; anything already
typed wins, `notes` appends under an `— imported` line, filled inputs wear a
yellow ring (`.import-flash` + `data-imported`) for three seconds, and
`armDedupeCheck()` runs immediately because re-importing a link someone already
added is the main way duplicates happen. A named broker is matched
case-insensitively against `brokers` and otherwise prefills the inline
"+ New broker" panel — prefilled, never auto-saved.

**Photos**: `photos.ts` (pure, tested) pulls candidate image URLs out of
`og:image`, JSON-LD, `__NEXT_DATA__` and `<img srcset>`, takes the largest
rendition, drops logos/maps/avatars/pixels, and caps at 12. The panel shows
them as a tick-grid, all selected. After `createListing` the dialog hands the
ticked URLs to `savePhotos(listingId, urls, personId)` and navigates away
without waiting — see **Photos** below.

**Deep link**: `/listings?import=<encoded url>` opens the dialog, fetches once
and cleans the address bar (`AddListingDialogSlot` wraps the `useSearchParams`
read in its own Suspense boundary). Built for a future iOS share-sheet
shortcut.

## Photos

Pictures of a listing come from two places — copied off the source site during
a URL import, and uploaded from a phone after a tour — and both go through
`POST /api/photos`.

**Storage**: a **public** Supabase bucket, `listing-photos`, 8MB per object,
webp/jpeg/png only (0007). Paths are `<listing_id>/<uuid>.webp` and
`<listing_id>/<uuid>_thumb.webp`. Rows in `listing_photos` store the *path*,
never the URL; `photoUrl(path)` in `src/lib/photos-client.ts` is the only place
one becomes the other, so moving projects is an env change. Public read is a
deliberate trade: the paths carry a random uuid, the images are of apartments
already advertised in public, and a signed URL per thumbnail would be a round
trip on every row of the table.

**The route** (`src/app/api/photos/route.ts`, `runtime = "nodejs"`,
`maxDuration = 60`):

- `POST { listingId, personId, urls[] }` — the import path. Each URL goes
  through `assertSafeUrl` (the import ladder's SSRF guard, re-checked on every
  redirect hop), then a fetch with a browser UA, a `Referer` of the listing
  page's origin (Zillow's image CDN 403s without it), a 6s timeout, an 8MB
  streamed cap and an `image/*` content-type check.
- `POST multipart/form-data` with `listingId`, `personId` and `files` — the
  manual path. The browser shrinks each file first (`src/lib/images.ts`,
  canvas → webp 1600px), so a phone is not pushing 4MB per photo.
- `DELETE { photoId }` — removes both objects and the row. 404 if it is gone.

**sharp** does the one re-encode: auto-orient from EXIF (`.rotate()` with no
argument), metadata stripped, main image webp ≤1280px q80, thumbnail webp
≤400px q70, four at a time. Uploads and rows are written with the **service
role** client (`src/lib/supabase/admin.ts`) after the route has checked the
session itself — the storage policies still allow an authenticated client to
write directly, but that is a backstop, not a second code path.

**A photo that fails is not a failed request.** Each one that does not make it
is an entry in `failed: [{ url | name, reason }]` beside the `photos` that did,
and the response stays 200. Only a request where *nothing* saved and every
failure had the same cause takes a status: 401 signed out, 404 unknown listing,
413 too big, 415 HEIC, 400 unsafe URL.

**HEIC**: iPhones set to "High Efficiency" hand over HEIC, Chrome's canvas
cannot decode it and `sharp` on Vercel has no libheif. It is rejected on the
name and the mime type with "Export as JPEG first" rather than failing
mysteriously. Safari usually converts to JPEG on upload, so this is rare.

**Activity**: one `added_photos` row per batch ("added 8 photos to 214 Grand St
#4B"), written by the route because it is the only thing that knows how many
survived, and only when at least one did. Deletions are not logged — removing a
blurry photo is not an impression.

**In the UI**: `PhotoGallery` sits at the top of the detail page (snap-scroll
strip on mobile, grid on desktop) with a lightbox on tap — arrow keys, swipe,
and a "3 / 9" counter. The listing cards show a 64px thumb, the table a 40px
one, and both fall back to a `bg-inset` tile with a lucide `Image` glyph so the
rows stay aligned. `listing_photos` is in the realtime publication and maps to
the `listings` / `listing(id)` keys, which is what makes an import feel live:
the dialog navigates away while the route is still working and thumbnails
appear one by one.

## Design system — "Dusk Candy"

**Dark only.** There is no light mode, no theme switcher and no `next-themes`
provider. `<html>` carries a permanent `dark` class (so the shadcn primitives'
`dark:` branches are the ones that apply) and every token is defined once in
`:root` in `src/app/globals.css`. The `.dark` block is gone — adding one back
would be a second source of truth.

| Role | Value | Token / utility |
|---|---|---|
| Page | `linear-gradient(180deg,#23204a,#1a1836)` fixed on `body`, flat `#1e1b40` fallback | `--background` |
| Text | `#f2efff` / muted `#b3aee0` / faint `#8b86bd` | `--foreground`, `--muted-foreground`, `text-faint` |
| Card | `#2f2b5e` | `--card` |
| Inset (panel on a card, table header) | `#26235a` | `bg-inset` |
| Row hover | `#34306a` | `hover:bg-surface-hover` |
| Border / secondary button | `#3c3778` | `--border`, `--secondary` |
| Primary | `#ffd56b` on `#1a1836` | `--primary`, `text-ink` |
| Urgency | overdue `#ff7f9f` / today `#ffd56b` / quiet `#8ed8ff` | `--urgent`, `--due`, `--quiet` |
| Votes | yes `#9df0b5` / maybe `#ffd56b` / no `#ff7f9f` | `--yes`, `--maybe`, `--no` |

`--radius` is `1rem`, so `rounded-xl` (what `Card` uses) is 22px; chips and
buttons are `rounded-full`. Font is **Nunito** 600/800/900 via `next/font/google`
— body 600, chips/labels 800, headings 900 at `-0.02em`. `--font-sans` in
`@theme inline` must name `var(--font-nunito)` explicitly: it used to be
`var(--font-sans)`, which referred to itself, and the font was never applied.

Contrast rule: `--muted-foreground` (`#b3aee0`) is fine on card and on inset;
`text-faint` (`#8b86bd`) is decoration only and must never carry anything
important on `bg-inset`.

- **Person colour is data, never a literal.** The four people's hexes live in
  `people.color` (`supabase/seed.sql`) and reach the screen only as an inline
  `style` — no component hardcodes a person's hex, so a fifth housemate is a row,
  not a patch. `PersonDot` (`src/components/person-dot.tsx`) is the single
  source: `person`, `size`, `withName`, `colorName`, and `letter` for the
  glyph-in-a-circle used by the vote chips. Colour identifies a person in nine
  places — listing card borders and rent, the table's 3px left rail, the detail
  header rule + "found this" line, queue owners, vote rows, the four vote
  circles, chat bubbles, the activity feed, and the person gate. Anything
  coloured that is *not* a person (urgency, votes, qualification) comes from the
  semantic tokens above, never from `people.color`.
- **Chunky buttons.** The primary variant carries `shadow-[0_4px_0_var(--primary-shadow)]`
  and compresses to `0_2px_0` on `:active`, so the base's `active:translate-y-px`
  reads as a press rather than a slide. The Yes vote button is the same trick in
  mint (`--yes-shadow`). Only these two: a chunky lip on every button is noise.
- Emoji are allowed in copy, sparingly. Icons are lucide, always.

## Architectural rules

- **All writes go through `src/lib/mutations.ts`.** Every mutation writes its row
  *and* the matching `activity` row with a pre-rendered `summary` string. No
  component calls `supabase.from(...).insert/update/delete` directly. Reads go
  through `src/lib/queries.ts` (key factory + fetchers + `use*` hooks); later
  phases add their verbs to `mutations.ts` and nowhere else. Photo writes obey
  the rule with a different transport: `uploadPhotos` / `deletePhoto` are
  exported from `mutations.ts` like everything else, but they `fetch` the API
  route, because `sharp` and the storage paths are server-side.
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
