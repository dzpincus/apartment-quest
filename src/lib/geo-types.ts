/**
 * The wire shapes of `POST /api/geocode` and `POST /api/commutes`.
 *
 * No `server-only` here on purpose: the routes import these *and* so does
 * `mutations.ts`, which runs in a browser. Same reasoning as `photo-types.ts`
 * and `sync-types.ts` — a client must never have to `import type` out of a
 * route module that also pulls in the Supabase admin client.
 */

import type { CommuteMode, CommuteTime, Uuid } from "@/lib/types";

// -- geocode ------------------------------------------------------------------

export type GeocodeSourceName = "nyc-geosearch" | "nominatim";

/** Either a listing to place, or a bare address to preview (locations dialog). */
export type GeocodeRequest =
  | { listingId: Uuid }
  | { address: string; unit?: string | null };

export type GeocodeResponse = {
  lat: number | null;
  lng: number | null;
  source: GeocodeSourceName | null;
  /** True when the match is a guess: show "⚠ check pin" and offer the drag. */
  lowConfidence: boolean;
  /** The listing that was written, when the request named one. */
  listingId?: Uuid;
  /** Set instead of coordinates when nobody could place the address. */
  error?: string;
  /** No provider is configured / reachable. Not an error anyone can act on. */
  disabled?: boolean;
};

// -- commutes -----------------------------------------------------------------

/**
 * What to fill in. Both ids absent means "every missing pair"; either one
 * narrows it. `force` ignores the 30-day freshness guard — the "Refresh times"
 * button, and nothing automatic.
 */
export type CommutesRequest = {
  listingId?: Uuid;
  locationId?: Uuid;
  force?: boolean;
};

export type CommutesResponse = {
  /** Pairs Google was actually asked about. */
  computed: number;
  /** Pairs left alone: already fresh, or out of time this run. */
  skipped: number;
  /** Of the computed ones, how many came back with an `error` stored. */
  errors: number;
  /** The rows written, ready to drop into a card without a refetch. */
  rows: CommuteTime[];
  disabled?: boolean;
  error?: string;
};

/** Empty response factory — a fresh `rows` array per call, like `emptySync()`. */
export function emptyCommutes(): CommutesResponse {
  return { computed: 0, skipped: 0, errors: 0, rows: [] };
}

/** How long a cached answer is trusted before it is worth asking again. */
export const COMMUTE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * How long a cached *failure* is trusted. An hour, not a month.
 *
 * A row with an `error` is not an answer — it is a note saying we could not
 * get one, and the reasons are almost all transient or fixable from outside
 * the app: a key restriction somebody corrects in the Google console, a
 * billing account switched on, a timeout, a 429, or a preview deployment's
 * dry-run. Trusting those for thirty days pins an em dash to the card long
 * after the cause has gone, and the only way back is a human pressing Refresh
 * on every listing. An hour is short enough that the fix shows up by itself
 * and long enough that a genuinely unroutable pair (no ferry, no bridge) is
 * not re-asked 900 times an afternoon.
 */
export const ERROR_MAX_AGE_MS = 60 * 60 * 1000;

/**
 * Is a cached row young enough to keep, or is it worth spending a Google call
 * on again? The whole freshness decision of `/api/commutes`, extracted so it
 * can be tested without a database — a mistake here is money.
 *
 * A row with no parseable `computed_at` is *not* fresh (it was never really
 * computed). A stamp in the future is treated as fresh: a clock disagreement
 * is not a reason to spend, and this route errs towards not spending.
 */
export function isFresh(
  row: { computed_at?: string | null; error?: string | null },
  now: number,
): boolean {
  const at = row.computed_at ? Date.parse(row.computed_at) : Number.NaN;
  if (!Number.isFinite(at)) return false;
  return now - at < (row.error ? ERROR_MAX_AGE_MS : COMMUTE_MAX_AGE_MS);
}

/** Labels and glyphs for the three modes, in the order the card shows them. */
export const COMMUTE_MODE_LABELS: Record<CommuteMode, string> = {
  walk: "Walk",
  bike: "Bike",
  transit: "Transit",
};

/**
 * The `travelmode` values Google Maps' *deep links* take — not the Routes API's
 * (`WALK`/`BICYCLE`/`TRANSIT`, which live in `src/lib/geo/routes.ts`). These
 * are for `https://www.google.com/maps/dir/?api=1&…`, which is free, keyless
 * and works on a phone.
 */
export const MAPS_LINK_MODE: Record<CommuteMode, string> = {
  walk: "walking",
  bike: "bicycling",
  transit: "transit",
};

/**
 * A directions link anybody can open. Coordinates rather than addresses on
 * purpose: the pin is what we measured from, and a typo'd street name would
 * send somebody to a different building than the one on screen.
 */
export function mapsDirectionsUrl(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  mode: CommuteMode,
): string {
  const params = new URLSearchParams({
    api: "1",
    origin: `${origin.lat},${origin.lng}`,
    destination: `${destination.lat},${destination.lng}`,
    travelmode: MAPS_LINK_MODE[mode],
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/** `1234` → `"21 min"`. Null / an errored row → `"—"`, never "0 min". */
export function commuteMinutes(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return "—";
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

// -- reading a pin ------------------------------------------------------------

/**
 * What the four geo columns add up to, for the three surfaces that draw a pin.
 *
 * `geocode_note` is provenance, not status (CLAUDE.md), so the *status* has to
 * be derived: a null `lat` with a `failed:` note means we looked and nobody
 * could place it; a null `lat` with no note means nobody has looked yet, which
 * is the only state worth offering a "Locate" button for. A `low-confidence`
 * note on a real pin is a placed listing wearing a "⚠ check pin".
 */
export type PinStatus = "placed" | "check" | "failed" | "unplaced";

export function pinStatus(row: {
  lat?: number | null;
  lng?: number | null;
  geocode_note?: string | null;
}): PinStatus {
  const note = row.geocode_note?.trim().toLowerCase() ?? "";
  if (row.lat == null || row.lng == null) {
    return note.startsWith("failed:") ? "failed" : "unplaced";
  }
  return note.startsWith("low-confidence") ? "check" : "placed";
}

/** The reason a geocode failed, in the provider's words. Null when it did not. */
export function geocodeFailure(note: string | null | undefined): string | null {
  const raw = note?.trim() ?? "";
  if (!/^failed:/i.test(raw)) return null;
  return raw.slice("failed:".length).trim() || "No provider could place it.";
}
