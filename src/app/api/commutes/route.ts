import "server-only";

/**
 * `POST /api/commutes` — fill in the missing squares of the grid.
 *
 *   {}                          every missing pair
 *   { listingId }               one listing against every saved location
 *   { locationId }              one location against every geocoded listing
 *   { force: true }             ignore the 30-day freshness guard
 *
 * The grid is (geocoded, live, still-in-play listings) × (saved locations) ×
 * (walk, bike, transit). Sixty listings and five locations is 900 rows —
 * computed *once*, cached in `commute_times`, and re-asked only when somebody
 * presses Refresh. That is the whole cost model: Google Routes bills per call,
 * and this route exists so the app makes each call at most once a month.
 *
 * Two doors, from `src/lib/api-auth.ts`: the session or the cron secret.
 *
 * Failure is per row, never per run. A pair Google refuses stores its `error`
 * and the other 899 carry on — `computeRoute` returns outcomes rather than
 * throwing, so a billing problem is 900 identical tooltips and not a 500.
 */

import { NextResponse } from "next/server";
import { authorized } from "@/lib/api-auth";
import { adminEnabled, createAdminClient } from "@/lib/supabase/admin";
import {
  computeRoute,
  nextWeekdayNineAmNY,
  routesEnabled,
  RoutesDisabledError,
} from "@/lib/geo/routes";
import { COMMUTE_MAX_AGE_MS, emptyCommutes, type CommutesResponse } from "@/lib/geo-types";
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Point = { id: Uuid; lat: number; lng: number };
type Pair = { listing: Point; location: Point; mode: CommuteMode };

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

  // What is already known. Only the freshness column is read — the values
  // themselves are on the listing rows the client already holds.
  const { data: existingRows, error: existingError } = await admin
    .from("commute_times")
    .select("listing_id, location_id, mode, computed_at, error")
    .in(
      "listing_id",
      listingPoints.map((p) => p.id),
    );
  if (existingError) {
    console.error("[commutes] cache read failed", existingError);
    return json({ ...emptyCommutes(), error: "Couldn't read the commute cache." }, 500);
  }

  const fresh = new Set<string>();
  if (!force) {
    for (const row of (existingRows ?? []) as CommuteTime[]) {
      const at = row.computed_at ? Date.parse(row.computed_at) : NaN;
      if (Number.isFinite(at) && started - at < COMMUTE_MAX_AGE_MS) {
        fresh.add(key(row.listing_id, row.location_id, row.mode));
      }
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
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, pairs.length) }, () => worker()),
  );

  // Whatever the pool never picked up.
  skipped += Math.max(0, pairs.length - rows.length);

  if (rows.length > 0) {
    const { error: writeError } = await admin
      .from("commute_times")
      .upsert(rows, { onConflict: "listing_id,location_id,mode" });
    if (writeError) {
      console.error("[commutes] write failed", writeError);
      return json({ ...emptyCommutes(), error: "Couldn't save the commute times." }, 500);
    }
  }

  console.info("[commutes] done", {
    computed: rows.length,
    skipped,
    errors,
    ms: Date.now() - started,
  });
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
