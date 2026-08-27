import { describe, expect, it } from "vitest";
import {
  loadStations,
  nearestStation,
  parseStations,
  resetStationCache,
  type Station,
} from "./stations";

/**
 * A five-station fixture with real coordinates, from the same MTA export that
 * `public/data/subway-stations.geojson` is trimmed out of. Small enough to
 * reason about, real enough that a swapped lat/lng shows up as a station in
 * the wrong borough rather than as a rounding difference.
 */
const FIXTURE = {
  type: "FeatureCollection",
  features: [
    feature("Bedford Av", ["L"], -73.95687, 40.7173),
    feature("Lorimer St/Metropolitan Av", ["G", "L"], -73.95034, 40.71385),
    feature("Graham Av", ["L"], -73.94425, 40.71486),
    feature("Nassau Av", ["G"], -73.95121, 40.72455),
    feature("14 St-Union Sq", ["4", "5", "6", "L", "N", "Q", "R", "W"], -73.99042, 40.73507),
  ],
};

function feature(name: string, lines: string[], lng: number, lat: number) {
  return {
    type: "Feature",
    properties: { name, lines },
    geometry: { type: "Point", coordinates: [lng, lat] },
  };
}

const STATIONS: Station[] = parseStations(FIXTURE);

describe("parseStations", () => {
  it("reads [lng, lat] the way GeoJSON writes it", () => {
    expect(STATIONS).toHaveLength(5);
    expect(STATIONS[0]).toEqual({
      name: "Bedford Av",
      lines: ["L"],
      lat: 40.7173,
      lng: -73.95687,
    });
    // Every station is in New York, which a swap would break loudly.
    for (const station of STATIONS) {
      expect(station.lat).toBeGreaterThan(40);
      expect(station.lat).toBeLessThan(41);
      expect(station.lng).toBeLessThan(-73);
    }
  });

  it("skips a broken feature rather than throwing over it", () => {
    const stations = parseStations({
      features: [
        { properties: { name: "Fine", lines: ["A"] }, geometry: { coordinates: [-73.9, 40.7] } },
        { properties: { name: "No geometry", lines: [] } },
        { properties: { name: "" }, geometry: { coordinates: [-73.9, 40.7] } },
        { properties: { name: "Not numbers" }, geometry: { coordinates: ["x", "y"] } },
        null,
      ],
    });
    expect(stations.map((s) => s.name)).toEqual(["Fine"]);
  });

  it("is empty for anything that is not a FeatureCollection", () => {
    expect(parseStations(null)).toEqual([]);
    expect(parseStations({})).toEqual([]);
    expect(parseStations("nope")).toEqual([]);
  });

  it("tolerates a feature with no lines", () => {
    const [station] = parseStations({
      features: [{ properties: { name: "Solo" }, geometry: { coordinates: [-73.9, 40.7] } }],
    });
    expect(station.lines).toEqual([]);
  });
});

describe("nearestStation", () => {
  it("finds the L stop a Williamsburg apartment actually walks to", () => {
    // 200 N 8th St, roughly.
    const nearest = nearestStation(40.7185, -73.9585, STATIONS);
    expect(nearest?.name).toBe("Bedford Av");
    expect(nearest?.lines).toEqual(["L"]);
    expect(nearest?.walkMin).toBeGreaterThan(0);
    expect(nearest?.walkMin).toBeLessThan(5);
  });

  it("picks a different station a few blocks east", () => {
    const nearest = nearestStation(40.7148, -73.9445, STATIONS);
    expect(nearest?.name).toBe("Graham Av");
  });

  it("carries the metres it measured, rounded", () => {
    const nearest = nearestStation(40.7173, -73.95687, STATIONS);
    expect(nearest?.meters).toBe(0);
    expect(Number.isInteger(nearest?.meters)).toBe(true);
  });

  it("says nothing rather than pointing at a station in another county", () => {
    // Princeton, NJ. The nearest fixture station is ~60km away.
    expect(nearestStation(40.3573, -74.6672, STATIONS)).toBeNull();
  });

  it("takes a wider radius when asked", () => {
    expect(nearestStation(40.3573, -74.6672, STATIONS, 100_000)?.name).toBeTypeOf("string");
  });

  it("is null with no stations, and with nonsense coordinates", () => {
    expect(nearestStation(40.7, -73.9, [])).toBeNull();
    expect(nearestStation(Number.NaN, -73.9, STATIONS)).toBeNull();
  });
});

describe("loadStations", () => {
  it("fetches once and memoises the promise", async () => {
    resetStationCache();
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return { ok: true, json: async () => FIXTURE } as Response;
    }) as unknown as typeof fetch;

    const [a, b] = await Promise.all([
      loadStations(fetchImpl, "/data/subway-stations.geojson"),
      loadStations(fetchImpl, "/data/subway-stations.geojson"),
    ]);
    expect(calls).toBe(1);
    expect(a).toBe(b);
    expect(a).toHaveLength(5);
    resetStationCache();
  });

  it("does not cache a failure — the next caller gets to try again", async () => {
    resetStationCache();
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) return { ok: false, status: 404 } as Response;
      return { ok: true, json: async () => FIXTURE } as Response;
    }) as unknown as typeof fetch;

    await expect(loadStations(fetchImpl, "/x")).rejects.toThrow();
    await expect(loadStations(fetchImpl, "/x")).resolves.toHaveLength(5);
    expect(calls).toBe(2);
    resetStationCache();
  });
});
