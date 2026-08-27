/**
 * The subway, as a static file.
 *
 * `public/data/subway-stations.geojson` is the MTA's own "Subway Stations"
 * export (data.ny.gov, dataset `39hk-dx4f`), trimmed to `{ name, lines }` per
 * *complex* — Times Sq is one place to walk to, not five — and rounded to five
 * decimals, which is about a metre. 445 features, ~60KB, no API, no key, no
 * quota. It is fetched once per session and memoised.
 *
 * Nothing here talks to a network the caller does not control, so this module
 * is safe on the client. `nearestStation` is pure.
 */

import { haversineMeters, walkMinutes, type LatLng } from "./haversine";

export type Station = {
  name: string;
  /** Daytime routes, numbers before letters: `["B", "C"]`, `["N", "Q", "R", "W"]`. */
  lines: string[];
  lat: number;
  lng: number;
};

export type NearestStation = {
  name: string;
  lines: string[];
  /** Straight-line metres — an estimate, and labelled as one on screen. */
  meters: number;
  walkMin: number;
};

export const STATIONS_URL = "/data/subway-stations.geojson";

/**
 * A station further away than this is not "the nearest station", it is a
 * different neighbourhood. Two kilometres is about a 25 minute walk.
 */
export const NEAREST_STATION_MAX_M = 2_000;

/**
 * GeoJSON in, plain rows out. Total: anything malformed is skipped rather than
 * thrown over, because a broken feature in a 445-entry file should cost that
 * one dot, not the whole map.
 */
export function parseStations(geojson: unknown): Station[] {
  const features = (geojson as { features?: unknown })?.features;
  if (!Array.isArray(features)) return [];
  const out: Station[] = [];
  for (const feature of features) {
    const f = feature as {
      properties?: { name?: unknown; lines?: unknown };
      geometry?: { coordinates?: unknown };
    };
    const coords = f?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    // GeoJSON is [lng, lat]. Getting this backwards puts the whole subway in
    // Antarctica, so it is worth saying out loud.
    const lng = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const name = typeof f.properties?.name === "string" ? f.properties.name : "";
    if (!name) continue;
    const lines = Array.isArray(f.properties?.lines)
      ? f.properties.lines.filter((l): l is string => typeof l === "string")
      : [];
    out.push({ name, lines, lat, lng });
  }
  return out;
}

/**
 * One station, as MapLibre wants it: a point, a name, and the routes already
 * joined into the string the symbol layer prints (`text-field` takes a
 * property, not an array, and doing the join per frame in an expression is
 * both slower and harder to read than doing it once here).
 *
 * Spelled out structurally rather than imported from `geojson`, which is a
 * transitive dependency of `maplibre-gl` and not ours — same reasoning as
 * `MapStyle` in `map-style.ts`.
 */
export type StationFeature = {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: { name: string; lines_label: string };
};

export type StationFeatureCollection = {
  type: "FeatureCollection";
  features: StationFeature[];
};

/**
 * The whole subway as one source. 445 points in a single GeoJSON source costs
 * one upload and no DOM at all, where 445 `Marker`s would be 445 absolutely
 * positioned elements repositioned on every frame of every pan.
 */
export function stationsGeoJSON(stations: readonly Station[]): StationFeatureCollection {
  return {
    type: "FeatureCollection",
    features: stations.map((station) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [station.lng, station.lat] },
      properties: { name: station.name, lines_label: station.lines.join(" ") },
    })),
  };
}

let cache: Promise<Station[]> | null = null;

/**
 * The stations, fetched once. The promise itself is cached, so ten pins asking
 * at the same moment share one request; a failed fetch clears the cache so the
 * next caller retries rather than inheriting the failure forever.
 *
 * `fetchImpl` exists for tests and for a server-side caller that would rather
 * hand over its own fetch than reach for a relative URL.
 */
export function loadStations(
  fetchImpl: typeof fetch = fetch,
  url: string = STATIONS_URL,
): Promise<Station[]> {
  cache ??= fetchImpl(url)
    .then((res) => {
      if (!res.ok) throw new Error(`stations: ${res.status}`);
      return res.json();
    })
    .then(parseStations)
    .catch((error) => {
      cache = null;
      throw error;
    });
  return cache;
}

/** Test seam — drops the memoised promise. */
export function resetStationCache(): void {
  cache = null;
}

/**
 * The closest station to a point, with the walking estimate attached. Null when
 * there are no stations to compare against, or when the closest one is further
 * than `NEAREST_STATION_MAX_M` — a listing in New Jersey should say nothing
 * rather than claim a 40 minute walk to the L.
 */
export function nearestStation(
  lat: number,
  lng: number,
  stations: readonly Station[],
  maxMeters: number = NEAREST_STATION_MAX_M,
): NearestStation | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const from: LatLng = { lat, lng };
  let best: Station | null = null;
  let bestMeters = Infinity;
  for (const station of stations) {
    const meters = haversineMeters(from, station);
    if (meters < bestMeters) {
      best = station;
      bestMeters = meters;
    }
  }
  if (!best || bestMeters > maxMeters) return null;
  return {
    name: best.name,
    lines: best.lines,
    meters: Math.round(bestMeters),
    walkMin: walkMinutes(bestMeters),
  };
}
