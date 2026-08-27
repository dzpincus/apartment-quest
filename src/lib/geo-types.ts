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
