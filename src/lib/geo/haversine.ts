/**
 * Great-circle distance and the one estimate derived from it.
 *
 * Pure, no network, no key, safe on both sides of the wire — the map uses it
 * for "nearest subway", and nothing here is ever a substitute for a routed
 * duration (Google Routes does that, and knows about rivers).
 */

export type LatLng = { lat: number; lng: number };

/** IUGG mean Earth radius, metres. */
export const EARTH_RADIUS_M = 6_371_008.8;

/**
 * How fast a person walks, in metres per minute. 80 m/min ≈ 4.8 km/h ≈ 3 mph —
 * the number NYC DOT and every transit app use for a pedestrian on a sidewalk,
 * and slow enough to survive a red light.
 */
export const WALK_METERS_PER_MINUTE = 80;

const toRad = (deg: number) => (deg * Math.PI) / 180;

/**
 * Metres between two points, as the crow flies. Straight-line: a walk to a
 * station across a park is honest, a walk to one across the East River is not,
 * which is why this is only ever used for "the nearest station is 4 min away"
 * and labelled as an estimate.
 */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Minutes on foot for a distance in metres, rounded to the nearest minute and
 * never zero: "0 min walk" reads as a bug even when the station is downstairs.
 * A negative or non-finite distance is 0 — there is nothing to walk.
 */
export function walkMinutes(
  meters: number,
  metersPerMinute: number = WALK_METERS_PER_MINUTE,
): number {
  if (!Number.isFinite(meters) || meters <= 0) return 0;
  if (!Number.isFinite(metersPerMinute) || metersPerMinute <= 0) return 0;
  return Math.max(1, Math.round(meters / metersPerMinute));
}
