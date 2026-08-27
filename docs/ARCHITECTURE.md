# Architecture

A tour of the parts that are not obvious from the file tree. `CLAUDE.md` in the
repo root is the exhaustive version — this is the map, not the territory.

## Data model

All tables live in Postgres on Supabase, all have RLS enabled with a single
policy, and most are in the Realtime publication. That policy tests
`public.is_app_user()` (migration `0011`) — true only for the one auth uid
stored in `app_config` — rather than the broader `auth.role() = 'authenticated'`
it used to, so a session Supabase issued to somebody else is not a session this
database answers.

| Table | Purpose |
|---|---|
| `people` | Fixed roster of four, written by `seed.sql`, plus `Quest Bot`. `color` is load-bearing UI; `annual_income` feeds the qualification math. |
| `brokers` | Name, company, phone, email, notes. Referenced by listings. |
| `listings` | The main record: address/unit, rent, beds/baths/sqft, fee, amenities, pets, `status` (ours), `listing_state` (the site's), the follow-up triple, coordinates, `dedupe_key` (generated), `merged_into`. |
| `listing_photos` | One row per stored image, main + thumbnail *paths* into the public `listing-photos` bucket (never URLs). |
| `interactions` | Call / email / text / tour / note against a listing. |
| `votes` | `(listing_id, person_id)` → yes / maybe / no + comment. |
| `messages` | `listing_id null` is the group thread; otherwise the listing's. |
| `thread_reads` / `global_reads` | Per-person read watermarks. Two tables because a null in a primary key is not a key. |
| `activity` | Append-only feed with a pre-rendered `summary` string. |
| `locations` | Shared saved places (work, gym, parents). Which ones a *device* shows is localStorage, not data. |
| `commute_times` | `(listing_id, location_id, mode)` → seconds / meters / error. The Google Routes cache. |
| `documents` / `doc_shares` | Defined in `0001` for phase 5 of `SPEC.md`; no UI was built. |
| `app_config` | One row, `owner_uid`. RLS on with **no policies** and grants revoked, so only `postgres` / `service_role` can read it; `is_app_user()` is `security definer` in order to. |

RPCs: `merge_listings`, `unread_counts`, `log_interaction`, `mark_thread_read`,
plus the `set_updated_at` and address-invalidation triggers.

## The write path rule

**Every write goes through `src/lib/mutations.ts`**, and every mutation writes
its row *and* the matching `activity` row in the same verb. No component ever
calls `supabase.from(...).insert/update/delete`. Reads go through
`src/lib/queries.ts` (a key factory, fetchers and `use*` hooks) and nowhere else.

Two consequences worth knowing:

- **Summaries are verb phrases without the actor** ("added 214 Grand St #4B"),
  because the feed already prints the person in their own colour. They are
  written at insert time so the feed stays one cheap query and old rows stay
  readable after the listing changes.
- **Impressions, not observations.** Reading a thread, opening a listing and
  deleting a blurry photo write no activity row. `updateListing` logs only when a
  meaningful column moved — `updated_at`, `last_contacted_at` and the
  `next_action*` triple are excluded, since those have their own verbs.

Photo writes obey the rule with a different transport: `uploadPhotos` /
`deletePhoto` are exported from `mutations.ts` like everything else, but they
`fetch` `/api/photos`, because `sharp` and the storage paths are server-side.
`log_interaction` and `mark_thread_read` are RPCs so that the row, the timestamp
bump and the status move cannot half-happen — and so the timestamps come from
the Postgres clock rather than a device's.

## Realtime is invalidation only

`RealtimeProvider` (`src/lib/realtime.tsx`) opens **one** channel and listens for
`postgres_changes` on messages, listings, votes, activity, interactions,
listing_photos, locations, commute_times, brokers and people.

A payload decides *which* query key to invalidate and is never written into the
cache: realtime payloads are flat table rows, so putting one into a cache entry
would drop the embedded `person` / `broker` / `votes` / `photos` /
`commute_times` joins that `LISTING_SELECT` fetches. `keysForChange(table, row)`
is the pure, tested mapping; invalidations are debounced 150 ms, so a message and
its activity row cost one refetch.

Two things fall out of that. Anything embedded in the listing row — votes,
photos, commute times — has no query key of its own, which is why an import can
navigate away and still pop thumbnails in one by one. And a DELETE under the
default replica identity carries only the primary key, so where `listing_id` is
absent the table-wide key has to do.

## The import ladder

`POST /api/import` takes `{ url }` or `{ text }` and returns a filled-in form.

1. **Direct fetch** — Chrome UA, 8 s, 2 MB cap, ≤3 redirects.
2. **Firecrawl** — only when a key is set *and* rung 1 came back blocked. Its own
   35 s timeout sits inside our 40 s socket timeout, because a page behind a bot
   wall regularly takes 20-30 s to render. Retried once for `/api/sync`, never
   for `/api/import` (a human is waiting and the rung below always works).
3. **Paste** — the response is `{ blocked: true, reason }` with a **200**, and
   the panel swaps in a textarea.

A site refusing us is not an error: a block, a captcha, a timeout or a
JavaScript-only shell each produce a `blocked` result with a sentence a human can
act on, never a 500.

Extraction is **one forced tool call** to `claude-haiku-4-5`
(`tool_choice: record_listing`), so the model cannot answer with prose.
`reduce.ts` shrinks the page to ~30k chars first (JSON-LD, `og:`/`twitter:` meta,
promising `__NEXT_DATA__` leaves, then visible text) and `coerce.ts` re-checks
every value that comes back: implausible rents are dropped, unknown enums fall
back to absent rather than wrong, `"N/A"` is an absence, lengths are capped and a
malformed email is discarded. Nothing the model says is trusted. Imported values
fill blanks only; anything already typed wins.

URLs are normalised (`normalizeListingUrl`: lower-case host, no fragment, no
`utm_*`/`fbclid`/`gclid`, no trailing slash) before the duplicate pre-check, so
the link shared over WhatsApp with a campaign tag is the same listing as the one
pasted from the address bar.

## The sync ladder and the NY-hour gate

`POST /api/sync` re-walks the same three rungs for every listing with a URL and
writes `listing_state` — **never** `status`. A page that vanished is news; the
decision stays with a human, on Home, in front of the evidence.

**Scheduling.** Supabase `pg_cron` + `pg_net` POST the route at 04, 05, 16 and 17
UTC; the route computes the current hour in `America/New_York` and returns
`{ skipped_hour_gate: true }` in milliseconds unless that hour is 0 or 12. EDT
makes 04/16 the working pair and EST makes it 05/17, so daylight saving needs no
deploy. Vercel Hobby crons cannot express this (once a day, UTC only) and GitHub
Actions schedules drift.

**Classification is three tiers, cheapest first** (`src/lib/import/classify.ts`):

1. A 404/410 or a redirect to a search page → `removed`.
2. The site's own machine status (`"status":"ACTIVE"`, `"homeStatus":"FOR_RENT"`,
   also matched in their escaped-JSON-inside-a-script form). *Any* live code wins;
   `off_market` needs every code on the page to be a dead one.
3. Words, but only in the primary content — `<title>`, `<h1>`s, `og:description`
   and the first 1,500 characters of visible text. A price-history table is not a
   banner. A `hasLiveSignals` guard defers when the page is clearly still selling.
4. Haiku (`classify_listing`, forced tool, ≤8k chars) for anything ambiguous —
   **and as a confirmation** whenever tier 3 alone wants to call a listing gone.

**A block is not a state, and neither is a shrug.** `learnedNothing`
(`src/lib/sync-types.ts`, pure and tested) is the single decision: on a block, an
error, a deadline skip, or an `unknown` over a listing we already had an answer
for, `listing_state` is left exactly as it was and only `state_checked_at` and
`state_note` move. A captcha wall cannot quietly kill a live listing, and a site
rewording its banner cannot walk the whole Vanished section back overnight. An
error still stamps `state_checked_at`, or the same broken listing sorts to the
front of every run forever.

The run has a wall clock as well as a count: `maxDuration` is 300 s, and
`RUN_BUDGET_MS` is *derived* from the worst-case single check (8 s fetch + 82 s
Firecrawl + 20 s Haiku + 10 s of headroom), because the deadline is checked
before a check starts and never during one. Whatever the run does not reach is
counted in `skipped_deadline` and, with its timestamp untouched, sorts first next
time.

## The commute cache and its cost guard

Geocoding is free and stored, never computed at read time: `POST /api/geocode`
resolves an address with NYC GeoSearch (Nominatim as a rate-limited fallback) and
writes `lat/lng/geocoded_at/geocode_note`. The note is provenance, not status —
`nyc-geosearch`, `nominatim`, `low-confidence (…)` (shown as "⚠ check pin" and
draggable, which writes `manual`) or `failed: …`. A null `lat` with a `failed:`
note means we looked; a null `lat` with no note means nobody has.

Commutes are the one metered thing. `POST /api/commutes` fills the *missing*
squares of (geocoded, live, in-play listings) × (saved locations) × (walk, bike,
transit) — for 60 listings and 5 places that is ~900 calls in total, not per
month. Guards, in order:

- **Freshness has two clocks** (`isFresh`, pure and tested): a real answer is
  trusted 30 days, a row carrying an `error` only one hour. A 403 is billing and
  a timeout is weather; neither is a fact about New York, and trusting one for a
  month pins an em dash to a card long after the cause is gone.
- **The freshness read fails closed.** It is scoped to both axes, explicitly
  bounded and asked for with `{ count: "exact" }`. If the count exceeds the rows
  returned, PostgREST truncated us — the run logs `refusing to spend` and 500s,
  because a row that looks uncached gets bought again.
- **`force` needs a target.** `{ force: true }` with no listing or location is a
  400: unscoped it means "re-buy the whole grid".
- **Rows are written as they are earned**, flushed every 50 and again in a
  `finally`. Google has been paid by the time a row exists.
- **Non-production is dry-run** unless `AQ_ROUTES_LIVE=1`, because every
  environment shares one key and one free tier.

`departureTime` for transit is the next weekday 09:00 in New York — a fixed rush
hour, so two listings looked at on different days stay comparable. A pair that
fails is not a failed run: the row stores its `error`, the card shows "—", and
the keyless Google Maps deep link beside it still works.

## The merge function

`merge_listings(src, dst)` folds a duplicate into a survivor in one transaction:
it refuses a self-merge and a target that is itself merged, repoints
`interactions`, `messages`, `listing_photos`, `votes`, `thread_reads` and
`commute_times` (the survivor's own rows win on conflict), backfills any column
the target left blank, and sets `src.merged_into = dst`. The `merged_listing`
activity row is written by `mergeListings` in `mutations.ts` afterwards, like
every other verb. Merged rows are hidden everywhere and excluded from the partial
indexes.

Two rules make it survive schema growth:

- **`'unknown'` is an absence, not an answer.** `pets`, the four amenity columns
  and `listing_state` all default to `'unknown'` and are never null, so the
  backfill cannot be a plain `coalesce` — each gets a `case` arm that takes the
  source's value when the target's is `'unknown'`. `blankForMerge` /
  `UNKNOWN_IS_BLANK` in `mutations.ts` mirror this for the add form's "merge into
  it" path; change one and you must change the other.
  `state_checked_at` is a `greatest()` (the last time *anybody* looked, which is
  what the sync queue orders by), not a coalesce.
- **It is redefined every time a column lands.** Seven versions live in the
  migrations — 0003, 0004, 0005, 0007, 0008, 0009 are history and **0010 is the
  live one**. `CREATE OR REPLACE` rewrites a function's configuration too, so
  every redefinition must restate `set search_path = public`.

The address-change triggers (0010) stand down while a merge is running
(`aq.merging`, transaction-local). Folding "214 Grand St" into "214 Grand St #4B"
is an address change as far as a trigger is concerned, and without the guard the
merge would delete the very `commute_times` rows it had just carried across.
