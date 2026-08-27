import { describe, expect, it } from "vitest";
import { haversineMeters, walkMinutes, WALK_METERS_PER_MINUTE } from "./haversine";

/**
 * Real New York coordinates throughout, because the failure mode this catches
 * is a swapped lat/lng — which is dimensionally fine and 6,000 km wrong.
 */
const BEDFORD_AV = { lat: 40.7173, lng: -73.95687 }; // L
const LORIMER_ST = { lat: 40.71407, lng: -73.95036 }; // L / G, ~700m away
const UNION_SQ = { lat: 40.73507, lng: -73.99042 };

describe("haversineMeters", () => {
  it("is zero for a point against itself", () => {
    expect(haversineMeters(BEDFORD_AV, BEDFORD_AV)).toBe(0);
  });

  it("measures a short Brooklyn walk", () => {
    const meters = haversineMeters(BEDFORD_AV, LORIMER_ST);
    expect(meters).toBeGreaterThan(600);
    expect(meters).toBeLessThan(800);
  });

  it("measures Williamsburg to Union Square", () => {
    // ~3.3km as the crow flies, across the river.
    const meters = haversineMeters(BEDFORD_AV, UNION_SQ);
    expect(meters).toBeGreaterThan(3_000);
    expect(meters).toBeLessThan(3_600);
  });

  it("is symmetric", () => {
    expect(haversineMeters(BEDFORD_AV, UNION_SQ)).toBeCloseTo(
      haversineMeters(UNION_SQ, BEDFORD_AV),
      6,
    );
  });

  it("knows a degree of latitude is about 111km", () => {
    const meters = haversineMeters({ lat: 40, lng: -74 }, { lat: 41, lng: -74 });
    expect(meters).toBeGreaterThan(111_000);
    expect(meters).toBeLessThan(111_400);
  });

  it("does not confuse lat with lng", () => {
    // A degree of longitude at 40°N is about 85km, not 111km. Swapping the
    // arguments in the formula would make these two equal.
    const northSouth = haversineMeters({ lat: 40, lng: -74 }, { lat: 41, lng: -74 });
    const eastWest = haversineMeters({ lat: 40, lng: -74 }, { lat: 40, lng: -73 });
    expect(eastWest).toBeLessThan(northSouth);
    expect(eastWest).toBeGreaterThan(80_000);
  });
});

describe("walkMinutes", () => {
  it("uses 80 m/min by default", () => {
    expect(WALK_METERS_PER_MINUTE).toBe(80);
    expect(walkMinutes(800)).toBe(10);
    expect(walkMinutes(400)).toBe(5);
  });

  it("rounds to the nearest minute", () => {
    expect(walkMinutes(650)).toBe(8); // 8.125
    expect(walkMinutes(700)).toBe(9); // 8.75
  });

  it("never says zero minutes for a real distance", () => {
    expect(walkMinutes(5)).toBe(1);
    expect(walkMinutes(39)).toBe(1);
  });

  it("is zero for nothing at all", () => {
    expect(walkMinutes(0)).toBe(0);
    expect(walkMinutes(-100)).toBe(0);
    expect(walkMinutes(Number.NaN)).toBe(0);
  });

  it("takes another pace", () => {
    expect(walkMinutes(1_000, 250)).toBe(4); // a bike, roughly
    expect(walkMinutes(1_000, 0)).toBe(0);
  });
});
