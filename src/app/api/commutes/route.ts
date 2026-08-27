import "server-only";

/**
 * `POST /api/commutes` — fill in the missing squares of the grid.
 *
 *   {}                          every missing pair
 *   { listingId }               one listing against every saved location
 *   { locationId }              one location against every geocoded listing
 *   { force: true }             ignore the freshness guard — with an id, only
 *
 * The grid is (geocoded, live, still-in-play listings) × (saved locations) ×
 * (walk, bike, transit). Sixty listings and five locations is 900 rows —
 * computed *once*, cached in `commute_times`, and re-asked only when somebody
 * presses Refresh. That is the whole cost model: Google Routes bills per call,
 * and this route exists so the app makes each call at most once a month.
 *
 * Three things follow from that, and all three are about not spending money:
 *
 * - **The freshness read is the guard.** It is scoped to both axes, bounded,
 *   and counted; a truncated read is a 500, not an empty cache. Fail closed.
 * - **`isFresh`** (`geo-types.ts`, pure and tested) decides row by row: thirty
 *   days for an answer, one hour for a stored failure.
 * - **`force` must name something.** Unscoped it is "re-buy the whole grid".
 *
 * Two doors, from `src/lib/api-auth.ts`: the session or the cron secret.
 *
 * Failure is per row, never per run. A pair Google refuses stores its `error`
 * and the other 899 carry on — `computeRoute` returns outcomes rather than
 * throwing, so a billing problem is 900 identical tooltips and not a 500. And
 * rows are flushed as they are earned, because a call Google has already
 * billed us for must survive whatever happens to the pool that made it.
 */

import { NextResponse } from "next/server";
import { authorized, UUID_RE } from "@/lib/api-auth";
import { adminEnabled, createAdminClient } from "@/lib/supabase/admin";
import {
  computeRoute,
  nextWeekdayNineAmNY,
  routesEnabled,
  RoutesDisabledError,
} from "@/lib/geo/routes";
import { emptyCommutes, isFresh, type CommutesResponse } from "@/lib/geo-types";
import { COMMUTE_MODES, type CommuteMode, type CommuteTime, type Uuid } from "@/lib/types";

export const runtime = "nodejs";
/** Four at a time, eight seconds each — this is the budget the pool respects. */
export const maxDuration = 120;

const CONCURRENCY = 4;
/**
 * The wall clock, not the pair count. Vercel kills the function at
 * `maxDuration` mid-write, so the pool stops handing out work with room to
 * spare and whatever it did not reach is counted in `skipped` — it has no
 * `computed_at`, so it sorts into the next run's missing list unchanged.
 */
const RUN_BUDGET_MS = 95_000;
/** A ceiling on one run regardless of the clock. 100 listings × 1 location × 3. */
const MAX_PAIRS = 300;

/**
 * How many rows may sit in memory unwritten. A pool that dies at row 249 — an
 * unexpected throw, a Vercel kill at `maxDuration` — used to lose every call
 * it had already paid Google for, and the next run would buy them all again.
 * Fifty is one small upsert per ~50 calls: cheap insurance on the only thing
 * in this app that costs money.
 */
const FLUSH_EVERY = 50;

/**
 * The ceiling on the freshness read. PostgREST caps a select at its own
 * `max-rows` and says so only in the `content-range` header, so the count is
 * asked for explicitly and compared — a silently truncated cache read would
 * look like "nothing is cached" and re-buy the whole grid.
 */
const CACHE_READ_LIMIT = 10_000;

type Point = { id: Uuid; lat: number; lng: number };
type Pair = { listing: Point; location: Point; mode: CommuteMode };

/** The freshness columns, and only those. The values ride on the listing row. */
type CachedRow = Pick<
  CommuteTime,
  "listing_id" | "location_id" | "mode" | "computed_at" | "error"
>;

function json(body: CommutesResponse, status = 200) {
  return NextResponse.json(body, { status });
}

export async function POST(request: Request): Promise<NextResponse<CommutesResponse>> {
  if (!(await authorized(request))) {
    return json({ ...emptyCommutes(), error: "Not for you." }, 401);
  }

  const body = (await request.json().catch(() => null)) as {
    listingId?: unknown;
    locationId?: unknown;
    force?: unknown;
  } | null;

  const listingId = typeof body?.listingId === "string" ? body.listingId.trim() : "";
  const locationId = typeof body?.locationId === "string" ? body.locationId.trim() : "";
  const force = body?.force === true;

  if (listingId && !UUID_RE.test(listingId)) {
    return json({ ...emptyCommutes(), error: "Which listing?" }, 400);
  }
  if (locationId && !UUID_RE.test(locationId)) {
    return json({ ...emptyCommutes(), error: "Which location?" }, 400);
  }
  // `force` is the one word that spends money on rows we already have answers
  // for. Unscoped, it is "re-buy the entire grid" — up to `MAX_PAIRS` Google
  // calls — from a single unlabelled button press or a stray curl. The UI only
  // ever sends it beside a listing (the detail card's "Refresh times"), so an
  // unscoped one is a mistake, and the cheapest place to catch it is here.
  if (force && !listingId && !locationId) {
    return json({ ...emptyCommutes(), error: "Forcing needs a listing or a location." }, 400);
  }

  // No key is not an error anybody can act on from a browser: the cards show
  // "—", the deep links still work, and nothing else in the app notices.
  if (!routesEnabled() || !adminEnabled()) {
    return json(
      {
        ...emptyCommutes(),
        disabled: true,
        error: "Commute times aren't configured on this deployment.",
      },
      503,
    );
  }

  const started = Date.now();
  const admin = createAdminClient();

  // Listings worth measuring: on the map, not merged, still in play. A listing
  // we passed on is nobody's commute.
  let listingQuery = admin
    .from("listings")
    .select("id, lat, lng")
    .is("merged_into", null)
    .not("lat", "is", null)
    .not("lng", "is", null)
    .or("status.is.null,status.not.in.(passed,lost)");
  if (listingId) listingQuery = listingQuery.eq("id", listingId);

  let locationQuery = admin.from("locations").select("id, lat, lng");
  if (locationId) locationQuery = locationQuery.eq("id", locationId);

  const [listings, locations] = await Promise.all([listingQuery, locationQuery]);
  if (listings.error || locations.error) {
    console.error("[commutes] read failed", listings.error ?? locations.error);
    return json({ ...emptyCommutes(), error: "Couldn't read the map data." }, 500);
  }

  const listingPoints = points(listings.data);
  const locationPoints = points(locations.data);
  if (listingPoints.length === 0 || locationPoints.length === 0) {
    return json(emptyCommutes());
  }

  // What is already known. Only the freshness columns are read — the values
  // themselves are on the listing rows the client already holds.
  //
  // Scoped to *both* axes and counted, because this read is the cost guard and
  // nothing else is. Filtering on `listing_id` alone meant a one-location run
  // still dragged back every location's rows for those listings, and an
  // unbounded select is silently capped by PostgREST's `max-rows`: the rows
  // past the cap look uncached, and "uncached" here means "buy it again".
  const {
    data: existingRows,
    error: existingError,
    count,
  } = await admin
    .from("commute_times")
    .select("listing_id, location_id, mode, computed_at, error", { count: "exact" })
    .in(
      "listing_id",
      listingPoints.map((p) => p.id),
    )
    .in(
      "location_id",
      locationPoints.map((p) => p.id),
    )
    .range(0, CACHE_READ_LIMIT - 1);
  if (existingError) {
    console.error("[commutes] cache read failed", existingError);
    return json({ ...emptyCommutes(), error: "Couldn't read the commute cache." }, 500);
  }

  const cached = (existingRows ?? []) as CachedRow[];
  // Fail closed. A short read is not "these are all the rows" — it is "we do
  // not know what is cached", and the only safe answer to that is to spend
  // nothing at all and say so.
  if (typeof count === "number" && count > cached.length) {
    console.error("[commutes] freshness read truncated — refusing to spend", {
      count,
      read: cached.length,
      listings: listingPoints.length,
      locations: locationPoints.length,
    });
    return json({ ...emptyCommutes(), error: "Couldn't read the commute cache." }, 500);
  }

  const fresh = new Set<string>();
  if (!force) {
    // `isFresh` is the whole decision, and it is pure and tested: a row with an
    // `error` is trusted for an hour, a real answer for thirty days.
    for (const row of cached) {
      if (isFresh(row, started)) fresh.add(key(row.listing_id, row.location_id, row.mode));
    }
  }

  const pairs: Pair[] = [];
  let skipped = 0;
  for (const listing of listingPoints) {
    for (const location of locationPoints) {
      for (const mode of COMMUTE_MODES) {
        if (fresh.has(key(listing.id, location.id, mode))) {
          skipped += 1;
          continue;
        }
        pairs.push({ listing, location, mode });
      }
    }
  }

  // Over the ceiling is not a failure — it is next run's work, and it still
  // has no `computed_at`, so nothing has to remember where we stopped.
  if (pairs.length > MAX_PAIRS) {
    skipped += pairs.length - MAX_PAIRS;
    pairs.length = MAX_PAIRS;
  }

  // One departure time for the whole run, so every transit number in it is
  // comparable with every other one.
  const departureTime = nextWeekdayNineAmNY(new Date(started));

  const rows: CommuteTime[] = [];
  let errors = 0;
  let cursor = 0;

  /**
   * Everything in `rows` reaches `commute_times`, whatever happens above.
   *
   * Google has already been paid by the time a row exists, so losing one to a
   * thrown error or a mid-run kill is money spent for nothing *and* work the
   * next run repeats. `flush` writes the tail of `rows` and is serialised
   * through a promise chain, so four workers crossing the mark at once is one
   * upsert rather than four overlapping ones with the same rows in them.
   */
  let flushed = 0;
  let flushing: Promise<void> = Promise.resolve();
  let writeFailed = false;

  const flush = (): Promise<void> => {
    flushing = flushing.then(async () => {
      const batch = rows.slice(flushed);
      if (batch.length === 0) return;
      flushed += batch.length;
      const { error: writeError } = await admin
        .from("commute_times")
        .upsert(batch, { onConflict: "listing_id,location_id,mode" });
      if (writeError) {
        writeFailed = true;
        console.error("[commutes] write failed", writeError);
      }
    });
    return flushing;
  };

  const worker = async () => {
    for (;;) {
      if (Date.now() - started > RUN_BUDGET_MS) return;
      const index = cursor++;
      const pair = pairs[index];
      if (!pair) return;
      let outcome;
      try {
        outcome = await computeRoute({
          origin: { lat: pair.listing.lat, lng: pair.listing.lng },
          destination: { lat: pair.location.lat, lng: pair.location.lng },
          mode: pair.mode,
          departureTime,
        });
      } catch (error) {
        // The only throw `computeRoute` has is "no key", and the guard above
        // already ruled that out — but if the env vanished mid-run, stop.
        if (error instanceof RoutesDisabledError) return;
        throw error;
      }
      if (!outcome.ok) errors += 1;
      rows.push({
        listing_id: pair.listing.id,
        location_id: pair.location.id,
        mode: pair.mode,
        seconds: outcome.ok ? outcome.seconds : null,
        meters: outcome.ok ? outcome.meters : null,
        computed_at: new Date().toISOString(),
        error: outcome.ok ? null : outcome.error,
      });
      if (rows.length - flushed >= FLUSH_EVERY) await flush();
    }
  };

  let poolFailed = false;
  try {
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, pairs.length) }, () => worker()),
    );
  } catch (error) {
    // `computeRoute` returns its failures rather than throwing, so anything
    // arriving here is a bug or an environment that fell over. Either way the
    // calls already made are still worth keeping — the `finally` below is what
    // keeps them.
    poolFailed = true;
    console.error("[commutes] pool failed", error);
  } finally {
    await flush().catch((error) => {
      writeFailed = true;
      console.error("[commutes] final flush failed", error);
    });
  }

  // Whatever the pool never picked up.
  skipped += Math.max(0, pairs.length - rows.length);

  if (writeFailed) {
    return json({ ...emptyCommutes(), error: "Couldn't save the commute times." }, 500);
  }

  console.info("[commutes] done", {
    computed: rows.length,
    skipped,
    errors,
    failed: poolFailed,
    ms: Date.now() - started,
  });
  if (poolFailed) {
    return json(
      {
        computed: rows.length,
        skipped,
        errors,
        rows,
        error: "Something broke partway through — the times we did get are saved.",
      },
      500,
    );
  }
  return json({ computed: rows.length, skipped, errors, rows });
}

function points(data: unknown): Point[] {
  if (!Array.isArray(data)) return [];
  const out: Point[] = [];
  for (const row of data as { id?: unknown; lat?: unknown; lng?: unknown }[]) {
    const lat = Number(row?.lat);
    const lng = Number(row?.lng);
    if (typeof row?.id !== "string" || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      continue;
    }
    out.push({ id: row.id, lat, lng });
  }
  return out;
}

const key = (listing: Uuid, location: Uuid, mode: CommuteMode) =>
  `${listing}|${location}|${mode}`;
