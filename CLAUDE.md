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
| `SUPABASE_SERVICE_ROLE_KEY` | Photos and sync. Read only by `src/lib/supabase/admin.ts` (which imports `server-only`). Missing -> `/api/photos` returns 500 and `/api/sync` returns 503 `{disabled:true}`; nothing else breaks. |
| `CRON_SECRET` | Listing status sync. The bearer token pg_cron sends to `/api/sync`, compared in constant time. Missing -> every cron call is a 401; "Check now" still works, since that path uses the session. Also accepted by `/api/geocode` and `/api/commutes` (`src/lib/api-auth.ts`). |
| `GOOGLE_MAPS_API_KEY` | Commute times. Google Routes API only, server-only. Missing -> `/api/commutes` returns 503 `{disabled:true}`, the commute cards show "—" and nothing else breaks. The map itself needs no key. |
| `AQ_ROUTES_LIVE` | Optional escape hatch. Outside production (`VERCEL_ENV !== "production"`) `computeRoute` does **not** call Google unless this is `1`: it logs `[routes] DRY-RUN` and returns `{ok:false, error:"dry-run (non-production)"}`. Previews and dev share the one key and the one free tier, and one preview branch backfilling 60 listings × 5 places is 900 calls nobody meant to buy. Dry-run rows carry the one-hour error TTL, so a preview cannot pin a month of em dashes onto rows production reads. |
| `NOMINATIM_CONTACT` | Optional. An email address or repo URL for rung two of the geocode ladder's `User-Agent` (`apartment-quest (<contact>)`), which Nominatim's usage policy requires. Missing -> that rung is skipped and logs `[geocode] nominatim disabled: set NOMINATIM_CONTACT`; NYC GeoSearch (rung one) still places almost every New York address. Never call them anonymously — that is what gets an application blocked. |

Missing env does not break `pnpm build` — Supabase clients only throw when
constructed at runtime, and the import route reads its key inside the request.

## Database

SQL lives in `supabase/`, applied by hand (no CLI link, no local stack):

- `supabase/migrations/0001_schema.sql` — tables + indexes
- `supabase/migrations/0002_rls.sql` — RLS on every table, one `authenticated` policy each (the predicate is superseded by 0011; the policy names and shape are not)
- `supabase/migrations/0003_rpc_triggers.sql` — `set_updated_at`, `merge_listings`, `unread_counts`, realtime publication
- `supabase/migrations/0004_review_fixes.sql` — `log_interaction`, `mark_thread_read`,
  `merge_listings` redefined (follow-up columns carried across, merged targets
  refused), `brokers` + `people` added to the realtime publication
- `supabase/migrations/0005_pets.sql` — `listings.pets` + `listings.pet_notes`,
  `merge_listings` redefined again (the pet columns carried across, `'unknown'`
  treated as an absence rather than an answer)
- `supabase/migrations/0006_listing_sync.sql` — `listings.listing_state` /
  `state_checked_at` / `state_note`, the partial `listings_sync` index, the
  `Quest Bot` person row, and the `pg_cron` + `pg_net` extensions. **Applies
  after 0007**: photos shipped first and took the next number. The four
  schedules and the Vault secrets are *not* in it — they carry the deployment
  URL and `CRON_SECRET` — and live in `supabase/cron.sql.example`, applied by
  hand (SQL editor or MCP `execute_sql`) once per project.
- `supabase/migrations/0007_photos.sql` — `listing_photos` + the public
  `listing-photos` storage bucket and its three `storage.objects` policies,
  `merge_listings` redefined once more (a duplicate's photos follow the
  survivor), `listing_photos` added to the realtime publication
- `supabase/migrations/0008_sync_merge.sql` — `merge_listings` redefined a
  fifth time so 0006's columns survive a merge: `listing_state` treated like
  `pets` (`'unknown'` is an absence), `state_checked_at` as `greatest()` (the
  last time *anybody* looked, which is what the sync queue orders by),
  `state_note` as `coalesce()`. No schema change — one function
- `supabase/migrations/0009_amenities.sql` — `listings.laundry` /
  `dishwasher` / `ac` / `outdoor_space`, and `merge_listings` redefined a sixth
  time so all four survive a merge (`'unknown'` is an absence, the same `case`
  arm `pets` gets)
- `supabase/migrations/0010_maps.sql` — `listings.lat` / `lng` /
  `geocoded_at` / `geocode_note` and the partial `listings_geo` index, the
  `locations` and `commute_times` tables (RLS + realtime), the two
  `listings_address_changed` triggers, and `merge_listings` redefined a seventh
  time (coordinates carried across, `commute_times` repointed)
- `supabase/migrations/0011_rls_hardening.sql` — `public.app_config`
  (RLS on, **no policies**, revoked from `anon`/`authenticated`) and
  `public.is_app_user()`, a `stable security definer` function that is true only
  for the uid stored there. Every `_authenticated` policy from 0002/0007/0010 is
  redefined against it, as are the three `storage.objects` policies. The uid
  itself is **not** in the repo: it goes in by hand from
  `supabase/owner.sql.example`, and **until it does, `is_app_user()` is false
  and every table reads empty** — 0011 fails closed on purpose, so the two run
  in the same sitting. A custom GUC (`alter database postgres set
  app.owner_uid`) would have been tidier and is not available: Supabase's
  `postgres` is not a superuser and answers `42501`. Photos are unaffected —
  the public-object endpoint `photoUrl()` builds does not consult RLS at all,
  so tightening `"photos public read"` closes the authenticated storage API and
  nothing a browser renders. This is defence in depth on top of "signups off,
  anonymous off": those are dashboard checkboxes, and `auth.role() =
  'authenticated'` means "any session Supabase will issue" the moment one gets
  un-ticked
- `supabase/migrations/0012_spotlights.sql` — `spotlights` (RLS pinned to
  `is_app_user()` like 0011, `set_updated_at` trigger, realtime), the
  `spotlights_listing` index, and `merge_listings` redefined an eighth time so a
  spotlight follows the survivor of a merge. A plain `update ... set listing_id`
  rather than the insert/on-conflict/delete the votes and commute rows need:
  `person_id` is the whole primary key, so repointing can never collide
- `supabase/migrations/0013_thread_summaries.sql` — `thread_summaries()`, one
  row per thread that has been spoken in (`listing_id` null = the group
  thread) carrying the count, the last timestamp, the last body and its
  author. `security invoker` + `stable` like `unread_counts`, so 0011's
  predicate still decides what comes back, and no explicit grant for the same
  reason. `distinct on (listing_id)` over a grouped count joined with `is not
  distinct from` — `=` would drop the group thread's count on the floor, since
  its key is NULL. No schema change — one function
- `supabase/seed.sql` — the four people (idempotent)

Apply via the Supabase SQL editor (paste + run) or the Supabase MCP
`apply_migration` tool, in **this** order:

```
0001 → 0002 → 0003 → 0004 → 0005 → 0007 → 0006 → 0008 → 0009 → 0010 → 0011 → 0012 → 0013
```

Filename order everywhere except the one swap: **0007 (photos) applies before
0006 (listing sync)**, because photos shipped first and took the next free
number while 0006 was written afterwards against a schema that already had it.
0006 is not "last" — 0008 onwards genuinely follow it. Then `seed.sql`, then
`owner.sql.example` with your auth user's uid filled in (0011 leaves the app
dark until that row exists). New changes go in a new numbered file; never edit
an applied one.

`merge_listings` is defined eight times — 0003, 0004, 0005, 0007, 0008, 0009
and 0010 are history, 0012 is the live version.
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
   **Two timeouts, not one**: Firecrawl's own `timeout: 35000` (plus
   `waitFor: 1500` for the bot wall's JavaScript) sits inside our 40s socket
   timeout, because a StreetEasy page behind PerimeterX regularly takes 20-30s
   to solve and render, and the old 15s client timeout was reporting "The
   scraping service didn't answer in time." for scrapes that were still
   working. A timeout or a 5xx is retried **once, after 2s** — but only for
   `/api/sync`: `/api/import` passes `{ retry: false }`, since a person is
   waiting inside a 60s function and the rung below (the paste box) always
   works. A 4xx and a `success: false` body are answers, and are never retried.
   A successful scrape logs `[firecrawl] took Nms`.
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
left on the end of the address is split off. Length is checked too: address,
neighborhood and the broker's name/company cap at 120 characters, the phone at
40, and an email is dropped outright unless it looks like one (half an email
address is worse than none). **Nothing the model says is trusted.**

**Cost**: ~10k input tokens per import on Haiku, i.e. cents per hundred
imports. Every call logs `input_tokens` / `output_tokens` via `console.info`.

**SSRF**: `assertSafeUrl` allows http(s) only, no credentials, ports 80/443,
and resolves the host — rejecting loopback, private, CGNAT, link-local
(`169.254.169.254`), ULA and multicast. `redirect: "manual"`, re-checked every
hop. Unit-tested in `fetch-page.test.ts`; `vitest.config.mts` aliases
`server-only` so those tests can run.

**Auth**: the route calls `getUser()` **before it reads the body** and 401s
without a session, so the anon key alone cannot spend tokens — or make us
buffer 200k characters of paste on the way to being told no. `src/proxy.ts` also answers signed-out `/api/*`
requests with a JSON 401 instead of redirecting a `fetch` to an HTML login page.

**In the UI**: `ImportPanel` sits at the top of the Add Listing dialog, above
the `<form>` element (not inside it — a stray Enter or a nested button would
submit the listing). Imported values **fill blanks only**; anything already
typed wins, `notes` appends under an `— imported` line, filled inputs wear a
yellow ring (`.import-flash` + `data-imported`) for three seconds, and
`armDedupeCheck()` runs immediately because re-importing a link someone already
added is the main way duplicates happen. That pre-check matches on
`normalizeListingUrl()` (`src/lib/url.ts`, pure and tested: lower-case host, no
fragment, no `utm_*`/`fbclid`/`gclid`, no trailing slash) as well as the raw
string, and `coerce.ts` stores the normalised form — so the link shared over
WhatsApp with a campaign tag on it is the same listing as the one pasted from
the address bar. A named broker is matched
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
`POST /api/photos`. A third door, `POST /api/photos/refresh`, is the first kind
again, later: the site published more of them after we imported it.

The wire shape (`SavePhotosResponse`, `PhotoFailure`) lives in
`src/lib/photo-types.ts` — no `server-only`, imported by the route and by both
clients, so nothing has to `import type` out of a route module that also
imports `sharp`. Same reasoning as `sync-types.ts`.

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
  canvas → webp 1600px), so a phone is not pushing 4MB per photo. The declared
  `content-length` is checked against 4.5MB (Vercel's own body limit) **before**
  `formData()` buffers anything: over it is a 413 with "Batch too big — add
  fewer photos at once", and `uploadPhotos` special-cases that status so the
  platform's own HTML 413 — which arrives with no JSON at all — still says the
  useful sentence.
- `DELETE { photoId }` — removes both objects and the row. 404 if it is gone.

**sharp** does the one re-encode: auto-orient from EXIF (`.rotate()` with no
argument), metadata stripped, main image webp ≤1280px q80, thumbnail webp
≤400px q70, four at a time. The decode is **capped at 40 megapixels**
(`limitInputPixels`) and `failOn: "truncated"`: 8MB of bytes is not 8MB of
pixels, and a 400KB PNG declaring 12,000 x 12,000 is an OOM that takes the whole
function with it rather than one failed photo. Dimensions are read from
`metadata()` before anything is decoded ("Couldn't read that image." with no
format, "That image is too large to process." over the cap — libvips usually
throws that one out of `metadata()` itself, which is mapped to the same
sentence). The thumbnail is derived from the **1280px main buffer**, not from a
second pass over the original, so a 40MP JPEG is decoded once. Uploads and rows are written with the **service
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
survived, and only when at least one did. `personId` has to name one of the
four humans — Quest Bot (`people.key = 'bot'`) is refused, because it signs
listing-state changes and has never been on a tour — and an id that names
nobody costs the feed line, not the photos. Deletions are not logged — removing
a blurry photo is not an impression.

**In the UI**: `PhotoGallery` sits at the top of the detail page (snap-scroll
strip on mobile, grid on desktop) with a lightbox on tap — arrow keys, swipe,
and a "3 / 9" counter. The listing cards give the photos the card's whole
width as a `PhotoCarousel` (`src/components/listings/photo-carousel.tsx`) in a
fixed 16:10 box — a native `snap-x` scroll container for swipe, with the
chevrons overlaid *inside* the picture so they can never land on the address
under it. A resting card renders exactly one `<img>`, slide 0; the first
touch, arrow click or arrow key **arms** it, every slide becomes real at once
and `prefetchPhotos` (`src/lib/photos-client.ts`) warms the whole set, because
sixty cards × eight photos is 480 requests for a page nobody has scrolled. A
tap that was not a swipe opens the same `PhotoLightbox` the detail gallery
uses; the map's mini card is the same carousel at 16:9. The table keeps its
40px thumb as a plain, inert image — 40px is too small to browse in, and a
picture is not a control — and puts a labelled **"Gallery · 8"** button
(lucide `Images`, `secondary`/`sm`) on the second line of the Address cell,
next to the unit, for rows that have photos: it prefetches the set and opens
the same shared lightbox at index 0. A listing with no photos gets no button
and still falls back to a `bg-inset` tile with a lucide `Image` glyph so the
rows stay aligned. Both places that
show a photo at size — the lightbox and the carousel — carry a **Full screen**
toggle in the corner of the image box (`useFullscreen` in
`src/lib/use-fullscreen.ts`, `FullscreenButton`): it takes *that element* full
screen, so the arrows, the swipe and the counter keep working, and the slides
switch to `object-contain` on black because a 16:10 crop is right for a card
and wrong for a whole screen. `fullscreenSupported(doc, el)` is the pure,
tested half — iPhone Safari has element full screen for `<video>` and nothing
else, so there the carousel's button opens the lightbox instead (same answer,
same tap) and the lightbox, already the size of the viewport, shows no button
at all. Escape is the browser's; `fullscreenchange` is the only thing that
flips the icon. The
arithmetic (`nextIndex`, `prevIndex`, `slidesToRender`) sits in
`src/lib/carousel.ts`, pure and tested. `listing_photos` is in the realtime
publication and maps to the `listings` / `listing(id)` keys, which is what
makes an import feel live:
the dialog navigates away while the route is still working and thumbnails
appear one by one.

**Sites add photos after we import them, so we go back.** `POST
/api/photos/refresh` `{ listingId, personId? }` re-fetches the listing page,
runs the same `discoverPhotos` over it, and copies across only what we do not
already hold — reply `{ discovered, added, skipped_existing, failed, blocked }`.
Two doors (`src/lib/api-auth.ts`: the session, or `Authorization: Bearer
$CRON_SECRET`), `maxDuration = 120` for the ladder plus twelve images, and it
is in `BEARER_ROUTES`. Discovery is capped at **40**, not the import's 12: the
photos we already have are at the *front* of the page, so a 12-deep look would
hand back exactly those and every refresh would find nothing. **12 new per
run**, and 60 across a whole `/api/sync` invocation.

**The identity of a photo is computed, never stored.** `photoSourceKey`
(`src/lib/import/photo-key.ts`, pure and tested) turns a URL into the key two
renditions of one picture share — Zillow states it outright
(`/fp/<hash>-<variant>.<ext>` → `zillow:<hash>`), StreetEasy and CloudFront put
it in the filename with the size beside it (`<host>:<filename minus
-large/-medium/_1024x768/-w800>`), everything else is `<host><pathname>`
lower-cased with the query gone. It is computed on **both** sides at compare
time, from `listing_photos.source_url`; there is no new column, because a
stored key goes stale the day a site changes its URL shape — and this one will.
`pickNewPhotos(candidates, existingSourceUrls)` (`src/lib/photo-resync.ts`,
pure and tested) is the whole decision, and its three counters always add up to
the candidates it was given. **A manual upload has a null `source_url` and
therefore no key**: a photo off somebody's phone is not a rendition of anything
and can never make a page's picture look like a duplicate.

The work itself is `syncListingPhotos` (`src/lib/photos-sync.ts`), which shares
every byte of the encode/upload/insert path with `POST /api/photos` — both call
`storePhotos` in `src/lib/photos-server.ts`, where the decode-bomb guard, the
objects-then-rows ordering and the rollback-on-insert-failure live. `added_by`
is the caller or **null** (Quest Bot has never been on a tour and does not own
a photo row), while the `added_photos` line — "added 3 new photos to 214 Grand
St #4B", written only when N > 0 — is signed by the caller or, on a crawl, by
Quest Bot, because `activity.person_id` is NOT NULL. On screen it is a
**Refresh photos** button in `PhotoGallery`, rendered only for a listing that
has a `url`, and it says "3 new photos" / "Nothing new" / "Site wouldn't let us
look". Nothing new is the *expected* answer and is reported as a success: the
dedupe working is the feature.

## Sync

Twice a day, every listing with a `url` gets looked at: `POST /api/sync` walks
the same fetch ladder the import uses, decides whether the page is still
selling the apartment, and writes `listing_state` — **never** `status`. A page
that vanished is news, not a decision. The decision ("Mark lost" / "Still
live") happens on Home, in front of the evidence.

**The schedule is four cron jobs and one `if`.** Vercel Hobby crons run once a
day in UTC, which cannot say "midnight and noon in New York"; GitHub Actions
schedules drift by minutes to hours. So Supabase `pg_cron` + `pg_net` POST the
route at **04, 05, 16 and 17 UTC** and the route computes the current hour in
`America/New_York`, doing nothing unless it is 0 or 12. EDT makes 04/16 the
right pair, EST makes it 05/17, and the two that are wrong return
`{ skipped_hour_gate: true }` in milliseconds. Nothing needs redeploying in
March or November. The statements live in `supabase/cron.sql.example`, with the
URL and the secret in Vault so `select * from cron.job` cannot print the token.

**Auth is two doors.** The cron sends `Authorization: Bearer $CRON_SECRET`,
compared with `timingSafeEqual`. A browser cannot hold that secret, so the
"Check now" button authenticates with the logged-in session instead — and a
session may only ask for `?listing=<id>`, never a whole crawl. `src/proxy.ts`
lets `/api/sync` past its signed-out guard, because it is the one route that
legitimately arrives with no cookies at all; the route itself is the gate.

**The ladder, with a smaller appetite.** Direct fetch, then Firecrawl, then say
so. Rung two is skipped when the listing's own `state_note` starts with
`blocked` and its `state_checked_at` is inside three days: a site that walled
us off this morning will wall us off tonight, and 60 listings twice a day would
eat Firecrawl's 500 free credits in under a week. A **manual** `?listing=`
check is exempt from the cooldown — one credit, asked for on purpose, by
somebody watching the button.

**Classification is three tiers, cheapest first** (`src/lib/import/classify.ts`;
the pure half is tested). 404/410 or a redirect to `/for-rent` → `removed`.
Then the **site's own status code**, then the words, then Haiku
(`classify_listing`, forced tool, ≤8k chars of reduced text). Anything unproven
is `unknown`, and `unknown` writes no activity row, shows no badge and moves
nothing.

**A live apartment spent a day in Vanished, and tiers 1 and 2 are the fix.**
The listing was a StreetEasy *unit* page,
`/building/913-st-johns-place-brooklyn/1r`, and it was called `off_market` on
the strength of "No longer available" — three occurrences, every one of them a
row in the **price-history table** describing a 2024 listing of the same
apartment (`data-testid="priceHistoryLink"`, `"status":"NO_LONGER_AVAILABLE"`).
The current listing was `"status":"ACTIVE"`, $4,350, "for rent", at the top of
the page. Four changes came out of it:

1. **Structured first.** `classifyStructured` reads the site's own machine
   status: `"status":"…"` on StreetEasy, `"homeStatus":"…"` on Zillow. **Any**
   live code (`AVAILABLE` / `ACTIVE` / `IN_CONTRACT` / `PENDING`, `FOR_RENT`)
   is `active` — a unit page carries three dead listings and one live one, and
   the live one is the only one anybody can rent. `off_market` needs unanimity:
   *every* code on the page a dead one, with a code from neither list enough to
   make us defer. Both sites embed their data as a JSON *string* inside another
   script, so the regex matches `\"status\":\"ACTIVE\"` as well as the
   unescaped form — matching only the latter finds nothing at all.
2. **The regex tier only reads the primary content**: `<title>`, every `<h1>`,
   `og:description`, and the first 1,500 characters of visible text
   (`primaryContent`). A banner is at the top of a page; a history table is
   not. There is a second guard, `hasLiveSignals`: three or more "for rent"s,
   or a price within 800 characters of "available", and the tier defers rather
   than calling it gone — with the dead phrases scrubbed out first, so "no
   longer available" cannot vouch for itself with its own last word. A dead
   phrase we decline to act on also blocks the price-and-beds `active`: a page
   with two stories on it is `ambiguous`, which is what the model is for.
3. **The prompt says so too** — price history and "previous listings" sections
   describe OLDER listings of the same unit; only the *current* listing counts.
4. **A regex-only `off_market` is not enough to move a listing.**
   `needsModelConfirmation` is true for exactly that case (a 404, a redirect
   and a structured code stand on their own), and `/api/sync` then calls Haiku
   as a **confirmation**. Agreement writes the transition with the page's own
   words as the note. Disagreement writes the model's verdict. And when the
   model cannot be asked at all — no key, nothing to send, the call threw — the
   row gets `unknown` and a note of `unconfirmed: <phrase>`, which
   `learnedNothing` then refuses to write over the state. Unconfirmed phrases
   move nothing. This is also what makes **Still live** stick: the note it
   writes starts with `manually confirmed`, and the next regex-only "gone"
   needs the model's agreement before it can flip that row back.

**A unit page is not a listing page.** `src/lib/import/canonical.ts` (pure,
tested) rewrites a StreetEasy `/building/<slug>/<unit>` URL to the
`/rental/<id>` the page names as live — from `<link rel="canonical">`, or from
the one `/rental/<id>` on the page with a live status beside it and a dead
status beside none of its mentions. `/api/import` stores that; **existing rows
are never rewritten**. On the page above it correctly rewrites *nothing*: all
five rental links are history rows sitting between an `ACTIVE` and a
`DELISTED`, and the live listing has no `/rental/` link on the page at all.

**A block is not a state, and neither is a shrug.** `learnedNothing`
(`src/lib/sync-types.ts`, pure and tested) is the single decision: a block, an
error, a deadline skip, *or* a page we did fetch and could not classify
(`unknown`) over a listing we already had an answer for. In every one of those
`listing_state` is left exactly as it was and only `state_checked_at` and
`state_note` move. A captcha wall can never quietly turn a live listing into a
dead one, and a listing site rewording its "no longer available" banner can
never walk the whole Vanished section back to `unknown` overnight. `unknown`
over `unknown` still writes — that is a first sighting, not a forgetting. The
detail page says "last check blocked — site won't let us look" rather than
presenting the stale chip as fact, and a `?listing=` run reports the state it
kept, never the `unknown` it declined to store.

**An error still stamps the row.** A failed check writes `state_checked_at` and
`state_note` (`error — <reason>`, which `isBlockedNote` deliberately does not
match) and leaves `listing_state` alone. Without the stamp the same broken
listing sorted to the front of every run forever and starved the other 59.

**The run has a wall clock, not just a count.** `maxDuration` is 300s and Vercel
kills the function at it, mid-write and with no response, so the pool stops
handing out work early; whatever it did not reach is counted in
`skipped_deadline` and, with `state_checked_at` untouched, sorts first next run.
`cron.sql.example` sets `timeout_milliseconds` to 300000 to match — that is how
long pg_net waits for the answer and **not** a cancellation of the Vercel
invocation.

`RUN_BUDGET_MS` is **derived, not typed in**: the deadline is checked *before* a
check starts and never during one, so the budget has to leave a whole worst-case
check behind it plus room for the writes — `300s − (8s fetch + 82s Firecrawl +
20s Haiku) − 10s`, i.e. 180s today. It used to be a literal 240s, which was true
at a 15s Firecrawl timeout and became a killed function the moment rung two grew
a 40s timeout and a retry. Change any of those three timeouts and the budget
moves with them.

**The run picks the photos up on the way past.** The page has already been
fetched to decide whether the apartment is still being let, so a listing that
came back `active` hands that same HTML to `syncListingPhotos` — no second
fetch of somebody's listing page in one invocation. It is skipped for a block,
an error and anything not `active` (a dead page publishes nothing worth
copying), it is wrapped in its own `try` so a photo CDN having a bad afternoon
cannot cost a listing its state write, and it has three budgets: 12 new photos
per listing, **60 across the run**, and its own wall clock (`PHOTO_BUDGET_MS`,
i.e. `maxDuration` minus a worst-case pickup and the writes) checked before
each one, because this happens in the tail of a 300s function. Each listing
that gained any logs `[sync] photos +N`, and the `[sync] done` line carries the
run's total. See CLAUDE.md → Photos for the dedupe.

**Quest Bot** (`people.key = 'bot'`, 0006) exists because `activity.person_id`
is NOT NULL. It signs the `listing_state_changed` rows ("noticed 214 Grand St
#4B looks gone (streeteasy.com: no longer available)" / "…is back up") and
appears in the feed with the quiet blue that is deliberately not in the roster
palette. `isBot` / `humans` (`src/lib/people.ts`, tested) keep it out of
everything that means *housemate*: the picker, the incomes list, the vote rows,
the four vote circles, the next-action owner and the qualification sum.
`PersonProvider` filters the roster once, so `usePerson().people` is
humans-only; the activity feed and the queue owner read their person from the
query's own join instead, which is why the bot still renders there.

**On screen**: Home gains a fourth section, **Vanished?**, under Gone quiet —
`listing_state in (off_market, removed)`, with the evidence, when it was last
checked, and two buttons: **Mark lost** (the ordinary `setListingStatus`) and
**Still live** (`listing_state = 'active'`, note `manually confirmed`, no
activity row — correcting a robot is not an impression). It is not in the nav
badge: news, not a deadline.

**The claim and the reply are now in the same place.** They were not: the badge
stated "gone?" in four places and took an answer in one, which is the whole of
"I see the gone labels but no other way to indicate status and no way to
confirm, label, or filter by listing status". `LinkActions`
(`src/components/listings/link-actions.tsx`) is the one component and the three
buttons — **Check now** always, **Still live** + **Mark lost** when the state is
`off_market` / `removed`, and a quiet **Report gone** (note `manually
reported`) when it is `active`. It renders on the detail page's "Link status"
row (chip, evidence, "checked 3h ago"), and inside the `gone?` badge's popover
in the table, the cards, the queue rows and the map's mini card. The badge is
read-only when it is given no `listing`. On the cards it moved *out* of the
`<Link>` wrapping the row: a popover trigger inside an anchor is invalid markup
and a tap that navigates instead of opening.

**Two statuses, said out loud.** `status` is where WE are (saved → contacted →
applied, ours, `StatusSelect`) and `listing_state` is what the SITE says (0006,
the sync's). The filters sheet says exactly that under its title, and
the link-state filter's options all read "Link: …" so they cannot be mistaken
for the other control. `linkState` (`matchesLinkState`, tested) is the
fourteenth filter and opens on `not_gone` — "Link: live + unchecked" — which
holds back `off_market` / `removed` rows and is the one value that does *not*
count as an active filter or wear a chip, because the default is the table's
resting state and not something somebody set. Every other pick does: the chips
read "Link: Any" / "Link: Gone" / "Link: Live" / "Link: Unchecked", where
`live` is `active` only, `gone` is `isVanished`, and `unchecked` is `unknown`
*and* a null column — a pre-0006 row and a row nobody has looked at are the
same absence. What the default hides is said out loud: `hiddenGoneCount`
(`src/lib/listing-filters.ts`) counts those rows against every *other* filter
and the toolbar draws "N gone hidden · show", which sets `linkState` to
`any`. `StatusSelect`'s trigger is tinted from `STATUS_TONE` (`format.ts`,
semantic tokens only — grey, `--quiet`, `--due`, lavender, `--yes`, and a faint
strike-through for passed/lost), because seven identical grey dropdowns down a
table is not a column anybody can read.

**Forcing a run** (dev server on :3000, or swap in the deployment host):

```bash
# the cron's door: everything, hour gate skipped
curl -sS -X POST "http://localhost:3000/api/sync?force=1" \
  -H "Authorization: Bearer $CRON_SECRET" | jq

# no bearer -> 401; right bearer at the wrong NY hour -> skipped_hour_gate
curl -sS -X POST "http://localhost:3000/api/sync" | jq

# one listing (what "Check now" sends, minus the session cookie)
curl -sS -X POST "http://localhost:3000/api/sync?listing=<uuid>&force=1" \
  -H "Authorization: Bearer $CRON_SECRET" | jq
```

Response: `{ ran, skipped_hour_gate, checked, changed: [{id,label,from,to}],
blocked, errors, skipped_deadline }`, plus `checkedListing` on a single-listing
run. The shape comes from `emptySync()` — a factory, not a shared constant, so
no two responses hand out the same `changed` array. Every run logs one
`[sync] done` line carrying the same numbers.

## Maps

Two questions, answered once each and then cached: **where is this apartment**
and **how long does it take to get from it to the places we care about**. Both
are free or nearly so, and the expensive one is metered on purpose.

**Providers.**

| Job | Provider | Cost | Key |
|---|---|---|---|
| Tiles / map rendering | MapLibre GL JS + **OpenFreeMap** (`tiles.openfreemap.org/styles/dark`, repainted Dusk Candy) | $0 | none |
| Geocoding | **NYC GeoSearch** (`geosearch.planninglabs.nyc`, Pelias, NYC-only), fallback **Nominatim** | $0 | none; `NOMINATIM_CONTACT` optional, and without it the fallback is skipped |
| Walk / bike / transit durations | **Google Routes API** `computeRoutes` | free tier 10k calls/mo | `GOOGLE_MAPS_API_KEY`, server-only |
| Subway stations | NYC Open Data / MTA export, bundled at `public/data/subway-stations.geojson` | $0 | none, no request |

Rejected: Mapbox (key, tracking, no transit), OSRM demo (car only), Valhalla
public (no NYC transit), OpenRouteService (walk/bike fine, no transit — the
documented fallback if Google billing is ever dropped), Google Maps JS for the
map itself (cost and tracking for something MapLibre does free).

**The pin is stored, never computed at read time.** `POST /api/geocode` takes
`{ listingId }` (geocode the stored address, write `lat/lng/geocoded_at/
geocode_note` with the admin client) or `{ address }` (coordinates only, for
the locations dialog's preview). It runs automatically after `createListing`
and after any edit where `addressChanged(patch, prev)` — fire-and-forget from
`mutations.ts`, so the add dialog navigates away and the pin arrives over
realtime like an imported photo.

`geocode_note` is provenance, not status: `nyc-geosearch`, `nominatim`,
`low-confidence (…)` — worth a human glance, shown as "⚠ check pin" and
correctable by dragging, which writes `manual` — or `failed: …`. **A null `lat`
with a `failed:` note means we looked; a null `lat` with no note means nobody
has.** Recording the failed attempt is what stops the automatic geocode
retrying forever on an address no provider can place.

**Editing an address throws both answers away.** Two triggers in 0010: a BEFORE
UPDATE one nulls the four geo columns, an AFTER UPDATE one deletes that
listing's `commute_times`. Both stand down while `merge_listings` is running
(`aq.merging`, transaction-local) — the merge backfill fills a blank `unit`
from the duplicate, which is an address change as far as a trigger is
concerned, and without the guard folding "214 Grand St" into "214 Grand St #4B"
would delete the very rows the function had just carried across.

**Commute times are a cache with a cost guard.** `POST /api/commutes`
`{ listingId?, locationId?, force? }` fills in the *missing* squares of
(geocoded, live, still-in-play listings) × (saved locations) × (walk, bike,
transit), four at a time, 8s per call. Sixty listings and five locations is
~900 rows **in total**, not per month.

**Freshness is `isFresh(row, now)`** (`src/lib/geo-types.ts`, pure and tested),
and it has two clocks: a real answer is trusted for 30 days
(`COMMUTE_MAX_AGE_MS`), a row with an `error` for one hour
(`ERROR_MAX_AGE_MS`). A failure is not an answer — 403s are billing, 429s pass,
timeouts pass, and a dry-run row is not a fact about New York at all — so
trusting one for a month pins an em dash to a card long after the cause is
gone, clearable only by a human pressing Refresh on every listing.

**The freshness read is the cost guard, so it fails closed.** It is scoped to
*both* axes (`listing_id` **and** `location_id` — a one-location run has no
business dragging back every location's rows), bounded with an explicit
`range`, and asked for with `{ count: "exact" }`. If the count exceeds the rows
that came back, PostgREST truncated us: the run logs `freshness read truncated
— refusing to spend` and 500s, because rows past the cap look uncached and
"uncached" here means "buy it again".

**`force` needs a target.** `{ force: true }` with no `listingId` or
`locationId` is a 400 ("Forcing needs a listing or a location."). Unscoped it
means "re-buy the whole grid", and the only button that sends it — the detail
card's "Refresh times" — always names a listing.

**Rows are written as they are earned**, not in one upsert at the end: the pool
flushes every 50 and the whole thing sits in `try/catch/finally` that flushes
again whatever happened. Google has been paid by the time a row exists, so
losing 249 of them to a throw is money spent twice. `departureTime` for TRANSIT is the next weekday
09:00 in New York (`nextWeekdayNineAmNY`, tested against both DST halves and
every day of the week) — a fixed rush hour, so two listings looked at on
different days are still comparable, and always in the future, which Google
requires.

**A pair that fails is not a failed run.** `computeRoute` returns
`{ ok: false, error }` rather than throwing for anything Google says — 403 is
billing or key restrictions, 400 is a request we got wrong — so a broken
deployment is 900 identical tooltips and not a 500. The row stores its `error`,
the card shows "—", and the Google Maps deep link beside it still works because
that costs nothing and needs no key. Missing key → 503 `{ disabled: true }`.

**Both routes have two doors**, factored into `src/lib/api-auth.ts` from the
sync route: the logged-in session, or `Authorization: Bearer $CRON_SECRET`
compared in constant time. `src/lib/supabase/middleware.ts` lets all four bearer
routes past its signed-out guard (`BEARER_ROUTES` — these two, `/api/sync` and
`/api/photos/refresh`) so a terminal can backfill without a browser:

```bash
curl -sS -X POST http://localhost:3000/api/geocode \
  -H "Authorization: Bearer $CRON_SECRET" -H 'content-type: application/json' \
  -d '{"listingId":"<uuid>"}' | jq

curl -sS -X POST http://localhost:3000/api/commutes \
  -H "Authorization: Bearer $CRON_SECRET" -H 'content-type: application/json' \
  -d '{"listingId":"<uuid>","force":true}' | jq
```

There is no SSRF surface on either route: every outbound host is a constant in
`src/lib/geo/*`, and a typed address only ever becomes a query-string value.
`assertSafeUrl` exists for the import ladder because *there* the person supplies
the host.

**Nominatim's policy is honoured, not assumed**: one request per second
(serialised through a queue in `geocode.ts`, so "Locate all" waits its turn
rather than getting us banned) and `User-Agent: apartment-quest (<contact>)`,
built by `nominatimUserAgent()` from **`NOMINATIM_CONTACT`** — an email address
or the URL of your fork. This is a public repository, so that contact is
configuration rather than a constant: a baked-in address is both a published
email and a lie the moment somebody else runs the code. **Unset means the rung
is skipped**, logging `[geocode] nominatim disabled: set NOMINATIM_CONTACT` and
returning null, which the ladder reads as "not found" — an anonymous call is
the one that gets the whole project blocked, so there is no fall-through to
one. It is the fallback and not the default, and anything it answers is flagged
low-confidence by definition — rung one is the one that actually knows New
York.

**Attribution is not optional.** MapLibre's attribution control stays visible on
every map (OpenFreeMap + © OpenStreetMap contributors — or © OpenStreetMap
contributors © CARTO when the style fetch fails and `loadMapStyle` falls back
to CARTO's keyless dark raster tiles). Google's terms allow Routes results to be
shown *without* a Google map only with a "Powered by Google" credit, so
`PoweredByGoogle` (`src/components/listings/powered-by-google.tsx`) is one
component rendered in all three places a `commute_times` number reaches a
screen: under the detail card's table, under the listings table and under the
mobile cards whenever the "Transit to ⭐" column is on. Neither is decoration;
removing either is a licence violation.

**No pin, no commute table.** Every cell in it is a Google Maps deep link built
from the listing's coordinates, and with none they are built from `0,0` — a
spot in the Gulf of Guinea. An unplaced listing gets the "Locate" block and
nothing else.

**Which places a person sees is a device preference, not data.** `locations` is
shared — one hunt, one list — and `src/lib/prefs.ts` keeps the toggles and the
starred place in localStorage (`aq.locations.hidden:<personId>`,
`aq.locations.primary:<personId>`) behind the same `useSyncExternalStore`
pattern `person.tsx` uses. Snapshots are cached against the exact stored string,
because a fresh `Set` per read is an infinite render loop.

localStorage outlives the row it names, so `usePrimaryLocationId(personId,
knownIds?)` takes the loaded list and returns null when the starred id is not in
it. Anybody can delete a saved place; without the check the other three devices
keep a "Transit to ⭐" column that can never be filled and a sort key that reads
every listing as null.

**The subway is a file, not an API.** `public/data/subway-stations.geojson` is
the MTA's own export trimmed to `{ name, lines }` per station *complex* (Times
Sq is one place to walk to, not five), rounded to five decimals — 445 features,
60KB. `nearestStation` is haversine plus 80 m/min, is labelled as an estimate
wherever it appears, and says nothing at all beyond 2km rather than claiming a
40-minute walk to the L.

**`commute_times` rides on the listing row.** `LISTING_SELECT` embeds
`commute_times(location_id, mode, seconds, meters, error)`, so the table
column, the map's mini card and the detail card all read from a query that
already runs — the same argument votes and photos won. `useCommutes(id)` is
`useListing(id)` with a `select`, i.e. one cache entry, and `commuteIndex` turns
the array into `location → mode → row`.

**The basemap is OpenFreeMap's `dark`, repainted.** `src/components/map/map-style.ts` fetches it once per session and runs `duskCandy()` over every
`paint` block: colours are parsed (hex, `rgb()`, the style's own `rgb(27 ,27
,29)`, `hsl`, and inside `interpolate` expressions), mapped by *lightness* onto
the palette — black to `#1a1836`, water to `#26235a`, road casings to
`#3c3778`, labels to `#b3aee0` — and written back with their alpha intact.
Background, water and label layers are pinned rather than ramped, because
OpenFreeMap's labels are near-black on grey and unreadable the moment the land
under them stops being white. A transform rather than a checked-in 900-line
JSON file: upstream can add a layer without us shipping a style that rots.

**The map is never on the listings page's critical path.** `maplibre-gl` is
~250KB gzipped, so `MapPanel` (which pulls in `ListingsMap`, which pulls in
MapLibre) and the detail card's `MiniMap` are both `next/dynamic` with
`ssr: false`. The chunk is fetched the first time somebody flips to Map and
never on the list. `MiniMap` is built once and is **zoomable but
cooperative**: `cooperativeGestures` makes a plain wheel or one-finger touch
scroll the page (ctrl/⌘ + wheel zooms, two fingers pan and pinch), the +/−
`NavigationControl` always works, and "Move pin" only rebuilds the *marker* as
draggable — the map is never torn down for a mode flip. MapLibre's stylesheet is imported *inside* those components
rather than in `globals.css`, and the pins' own CSS is a `<style>` tag injected
by `ensureMapCss()` on first mount — no route pays for a rule about `.aq-pin`
until it has actually asked for a map.

**Pins are DOM, not symbol layers.** Sixty listings is far below where a
GeoJSON source, an icon sprite and `queryRenderedFeatures` would pay for
themselves, and `Marker({ element })` gets focus rings, `aria-label`s and a
person's `people.color` as an inline style for free (`pin.ts`). The rent on a
pin is `rentShort` (`$5.2k`), not `moneyShort` (`$5k`): whole thousands round
two different apartments to the same label, which is fine in a qualification
badge and useless on a map. Selection is a
`data-selected` flip on an element that already exists, not a rebuilt marker,
so tapping around never makes the map blink. Fit-bounds fires when *which*
listings are on screen changes and not when the selection does — a map that
re-frames itself while somebody reads a card is arguing with them. Station dots
are drawn for the viewport at zoom >= 14 only, because 445 of them city-wide is
a grey wash.

**List or map is a device preference too** — `aq.listingsView` in `prefs.ts`,
same guarded store as the location toggles, defaulting to the list on the
server so the toolbar never flashes the wrong control. Map mode is handed the
*same* `rows` array the table gets, already filtered and sorted, so the pins and
the list cannot disagree. "N unlocated · Locate all" calls the module-level
`geocodeListing` in series rather than the `useMutations` hook — the hook owns a
loading toast per call, which is right for one button and a toast storm for
sixty — then fills every newly computable pair with a single `computeCommutes({})`.

**"Transit to ⭐" is a column that mostly is not there.** It appears in the
table (after Votes), in the mobile cards and in the sort list only when this
device has starred a place; `transitSeconds(row, locationId)` reads the
embedded `commute_times`, returns null for a missing or errored pair, and the
sort sinks nulls like every other column. It never asks Google anything —
"Refresh times" on the detail card is the only button that spends.

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
| Urgency | overdue `#ff7f9f` / today `#ffd56b` / quiet `#8ed8ff` / new `#7fe3cd` | `--urgent`, `--due`, `--quiet`, `--fresh` |
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
- **The amenity enums (0009) are `pets` four more times.** `laundry`
  (`in_unit` / `in_building` / `none` / `unknown`), `dishwasher` (`yes` / `no` /
  `unknown`), `ac` (`central` / `window` / `none` / `unknown`) and
  `outdoor_space` (`private` / `shared` / `none` / `unknown`) each default to
  `'unknown'`, which every layer treats as an absence: the `case` arms in
  `merge_listings`, `UNKNOWN_IS_BLANK` in `mutations.ts`, the import's "omit
  rather than guess" rule in `coerce.ts`, and `?? "unknown"` at every read.
  `none` is the opposite — a real answer ("this building has no laundry") that
  `coerce.ts` deliberately exempts from the word-that-means-blank list. The
  table shows all four in one sortable **Amenities** column ranked by
  `amenityRank` (laundry decides, then AC, then outdoor space, then the
  dishwasher, packed lexicographically so a dishwasher can never outvote an
  in-unit washer); the cards show them as chips; `unknown` prints nothing at
  all rather than four em dashes.
- **The table's columns are a budget.** There is no **Fee** column: `fee_type`
  is edited on the detail page and filtered from the toolbar, and its sort key
  is gone with the column (nothing else offered it). The width went to Address
  and Amenities. **Rent never truncates** — the cell is `min-w-[5.5rem]
  whitespace-nowrap tabular-nums` and the `InlineEdit` inside it overrides the
  `w-full max-w-full truncate` baked into that component's button
  (`text-clip` is what makes tailwind-merge drop `truncate`), because "$5,2…"
  is not a rent. Bd / Ba is one nowrap phrase, "3 / 3", not two fixed-width
  boxes with a slash floating between them.
- **Qualification math**: `required = rent * income_multiplier` — NYC 40x means
  combined *annual* income >= 40x *monthly* rent. `SPEC.md` writes
  `rent * 12 * income_multiplier`, which applies the 40x twice; the convention it
  cites wins over its own formula. Documented in `qualification()`.
  `QualifyBadge` prints the two numbers and nothing else (`$310k / $288k`,
  combined over required), tinted mint or coral. There is no PASS/FAIL word:
  the verdict was louder than the figures it was derived from, and "FAIL" is a
  harsher sentence than a listing 2% over the line has earned.
- **`person_id` comes from `usePerson()`** (`src/lib/person.tsx`), never from a prop
  drill or a fresh localStorage read, and is passed explicitly into every
  `mutations.ts` call (`useMutations(person?.id)`).
- **Two gates**: real Supabase auth (guarded server-side in `src/proxy.ts` — Next 16's
  renamed `middleware.ts`) then the person picker. The login email is an internal
  identifier and must never be rendered.
- **Follow-up queue**: bucketing lives in `src/lib/queue.ts` and is pure —
  `bucketListings(rows, { todayNY, now })` takes the clock as an argument so the
  boundaries are testable (`src/lib/queue.test.ts`). Buckets: overdue
  (`next_action_due < today`), today (`= today`), vanished (`listing_state` is
  `off_market` / `removed` — see **Sync**), cold (`status = 'contacted'`,
  `last_contacted_at` older than 24h, no `next_action`), fresh (`status =
  'saved'`, no `next_action`, nothing scheduled — the **New** section, newest
  `created_at` first, lowest precedence of the five and deliberately *not* in
  the nav badge: every listing starts there, so counting it would put a
  permanent number on the tab). Merged rows and
  `passed` / `lost` are excluded, a listing lands in at most one bucket, and any
  due date at all keeps a listing out of Cold. Vanished loses to the two date
  buckets (a commitment made for today outranks the news, and the row wears a
  `gone?` badge wherever it lands) and beats Cold (a page that disappeared is a
  better explanation of silence than nobody calling). `setListingStatus` to passed/lost
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
- **`/chat` is a list of threads with one of them open**, Slack's shape. The
  left pane is every conversation that has been spoken in — `thread_summaries()`
  (0013) joined against the listings the page already holds and the unread
  summary, by `buildThreadList` (`src/lib/threads.ts`, pure and tested): the
  group thread is **always present and always first** even at zero messages,
  listing threads follow newest-first, and a summary naming a merged or
  unknown listing is dropped rather than drawn as "(unknown)". The right pane
  is the same `<Thread>` the listing page has always used. **The open thread is
  the URL** — `?t=<listingId>`, with absent and `global` both meaning the group
  thread — so a thread is shareable, a refresh survivable, and Back is a real
  exit. Under `md` only one pane fits and the param decides which: no `t` is
  the list, a `t` is the thread with a back chevron that `replace`s. That is a
  media query (`useIsDesktop`) and **not** two CSS-hidden panes, because
  `<Thread>` marks itself read on mount and a hidden-but-mounted thread would
  clear a badge for messages nobody saw. Rows push under `md` (so Back comes
  out of a thread) and replace at `md` and up (so skimming does not stack
  twenty history entries). Above a listing's messages sits **the queue card** —
  `QueueRow`, the same component Home draws, tinted by `bucketOf` /
  `bucketTone` (`lib/queue.ts`, both tested), falling back to `var(--border)`
  for a listing in no bucket at all. A conversation about an apartment is
  nearly always about the next thing somebody has to do about it, and "Log
  contact" belongs where that conversation is. The nav's Chat badge still
  counts *group* messages only: it is a tab badge, and the listings with
  something new are already counted on the Listings tab.
- **Unread is two questions, one RPC.** `unreadSummary(unread)`
  (`src/lib/unread.ts`, pure and tested) turns the summary into
  `{ chatCount, listingIds }`, and everything that badges anything reads it:
  the Chat tab counts *messages* in the group thread, the Listings tab counts
  *listings* with something new (counting messages there would put a number in
  the tens on a tab whose job is "which rows should I open"), the listings
  table and cards badge their own row, and Home's `UnreadStrip` — an inset pill
  above the queue chips, hidden at zero — links `/chat` and either `/listings`
  or, for a single listing, straight to `/listings/<id>#thread`. Unread badges
  are the primary tint (`UnreadBadge`); the red one in the nav is `DueBadge`
  and means a deadline, not a conversation. `#thread` is a real destination:
  the detail page's thread Card carries `id="thread"` and scrolls itself there
  on mount, because the anchor does not exist yet when Next would have scrolled
  — arriving marks it read, since `Thread` does that on mount. A `messages`
  insert invalidates `["unread"]` (see `keysForChange`), which is a prefix of
  `["unread", personId]`, so somebody else posting lights the badge live.
- **Notifications are Web Notifications, not Web Push.** A new message becomes
  a banner **only while a tab of this app is open somewhere**: no service
  worker, no VAPID key pair, no subscription row, nothing to unsubscribe from.
  Four people who each keep the app in a tab do not need a push service, and a
  push service needs a server component nobody would maintain. `shouldNotify` /
  `notificationBody` / `isThreadOnScreen` (`src/lib/notifications.ts`, pure and
  tested) are the whole decision: not yours, the device preference is on, the
  permission is `granted`, and **not** (the tab is visible *and* this message's
  thread is the one on screen) — notifying somebody about a message they are
  reading is how notifications get switched off for good. A message in another
  thread still buzzes with the tab in front of you, since the only other sign
  of it is a small badge in a corner. The tag is `thread:<listingId|global>`,
  so a burst collapses to one banner per thread, and the click focuses the
  window and routes to `/chat?t=…`. **The preference is per device and per
  person** (`aq.notify:<personId>` in `prefs.ts`, the same guarded
  `useSyncExternalStore` the location toggles use) and is deliberately not the
  same thing as the browser's permission: somebody who said yes six weeks ago
  and has since had enough turns off the preference, not the browser, and gets
  it back with one tap. `NotifyToggle` (in the thread header) says which of the
  four states it is in — `unsupported` and `denied` are disabled buttons with a
  sentence, `default` asks and fires one test banner on a yes, `granted`
  toggles. **`NotificationsProvider` opens its own channel** (`notify`, INSERT
  on `messages` only), because `RealtimeProvider` is invalidation-only by rule
  and this needs the row's body, author and thread; two subscriptions ride one
  websocket, since `createBrowserClient` memoizes per url+key. Everything
  mutable is read through a ref so a preference change never re-joins the
  channel, the listing's name comes out of the `["listings"]` cache
  (`getQueryData`, never a request), and `new Notification` is wrapped in
  `try/catch` — Chrome on Android throws for one constructed outside a service
  worker. **iOS needs the app on the Home Screen**: Safari has no
  `window.Notification` in a tab at all, which is why
  `public/manifest.webmanifest` and `appleWebApp` in the root layout exist —
  the manifest is what makes "Add to Home Screen" install rather than bookmark.
  `icon-192.png` / `icon-512.png` come from `scripts/make-icons.mjs` (a
  one-off, committed, paths not text — libvips font support is not something to
  bet an icon on); the iOS icon stays `src/app/apple-icon.tsx`, and there is no
  `icons.apple` in the metadata because two `rel="apple-touch-icon"` links
  would leave the choice to tag order. `src/proxy.ts` never sees any of it: its
  matcher already excludes anything ending `.webmanifest` or `.png`, which is
  what stops a credentials-less manifest fetch being answered with a redirect
  to `/login` (verified: `curl -sI /manifest.webmanifest` → 200 signed out,
  `/chat` → 307). Note that Next 16 emits the standardised
  `mobile-web-app-capable` meta rather than the `apple-` prefixed one; iOS
  16.4+, which is the floor for Home Screen notifications anyway, reads it.
- **Activity rows link where they point.** `activityHref(item)`
  (`src/lib/activity.ts`, pure and tested) is the only place that decides:
  a listing entity -> that listing, `messaged` about a listing -> its
  `#thread`, a global `messaged` (filed under `entity_type: "message"`) ->
  `/chat`, `added_broker` -> `/brokers`, anything else -> `null` and the row
  stays text. The whole row is the target, 44px tall under `md`.
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
  a guard rail and not a permission — one shared login, no boundary. `VotesCard`
  renders inside the detail **header**, under the CTA row, in its `compact`
  shape: same four rows and the same toggles, but a flat section with a top
  divider instead of a Card, because a card inside the header block doubles
  every border.
- **Spotlights are one per person, and the key says so.** "Look at this one!"
  (0012) promotes a listing to Home with a reason for the other three to read;
  `spotlights.person_id` is the primary key, so setting a second one *replaces*
  the first rather than adding to it, and the dialog says which listing it is
  about to replace before the button is pressed rather than after. The note caps
  at 280 characters in the input (`SPOTLIGHT_NOTE_MAX`, not a CHECK constraint —
  a limit somebody can watch themselves approach belongs in the textarea) and
  the feed repeats the first 80 of it in curly quotes. Rows ride on the listing
  row for the fifth time: `LISTING_SELECT` embeds
  `spotlights(person_id, note, created_at)`, Home's `SpotlightStrip` reads the
  `["listings"]` entry the queue and the nav badge already hold, and realtime
  routes a `spotlights` change to `listings` / `listing(id)` — with the *wide*
  key on a delete, because the primary key is `person_id` alone and "Remove
  spotlight" therefore arrives with no `listing_id` at all. **A dead listing
  drops out at read time, not by deleting anything**: `activeSpotlights`
  (`src/lib/spotlight.ts`, pure and tested) hides merged rows, `passed`/`lost`
  ones and the bot, so un-passing a listing brings the spotlight and its note
  straight back — while `mySpotlight` deliberately does *not* filter, since a
  hidden spotlight still occupies the one slot its owner has. Two verbs,
  `spotlighted` and `unspotlighted`, both filed against the listing so
  `activityHref` lands the feed line on it. Not optimistic: a dialog with a Save
  in it should close when the write lands, which is the opposite of the
  three-buttons-in-a-row argument that makes votes optimistic.
- **Time**: store UTC, render New York. Use `fmtNY` / `todayNY` from `src/lib/time.ts`;
  never `new Date().toLocaleString()` and never compare dates in local time.
- **Mobile-first**: bottom tab bar under `md`, top bar at `md` and up.
- Types in `src/lib/types.ts` are hand-written and must be updated alongside any
  schema migration.
- There is no per-person security boundary. One shared login, everyone sees and
  edits everything. Intentional. What there *is*, since 0011, is a boundary
  around the login itself: every policy tests `public.is_app_user()`, so the
  database answers one nominated uid rather than "anyone Supabase issued a JWT
  to". Between the four of us that changes nothing; it is what makes a stray
  anonymous sign-in or an accidentally re-opened signup form a dead end instead
  of a full read. Adding a fifth person is still a `people` row — the pin is on
  the auth account, not the roster.
