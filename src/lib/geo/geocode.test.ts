import { describe, expect, it } from "vitest";
import { geocodeFailureNote, geocodeNote, GeocodeError, normalizeForGeocode } from "./geocode";

/**
 * Only the pure half is tested — the two providers are somebody else's servers
 * and mocking their JSON would test the mock. What *is* worth pinning is the
 * string we send them, because "214 Grand St #4B" and "214 Grand St" resolve to
 * different things, and a missing borough is the difference between Manhattan
 * and Brooklyn.
 */

describe("normalizeForGeocode — units", () => {
  it("strips a hash unit", () => {
    expect(normalizeForGeocode("214 Grand St #4B")).toBe("214 Grand St, New York, NY");
  });

  it("strips the spelled-out ones", () => {
    for (const written of [
      "214 Grand St Apt 4B",
      "214 Grand St, Apt. 4B",
      "214 Grand St Unit 4B",
      "214 Grand St Suite 4B",
      "214 Grand St Fl 4",
    ]) {
      expect(normalizeForGeocode(written)).toBe("214 Grand St, New York, NY");
    }
  });

  it("strips a unit sitting in the middle of the address", () => {
    expect(normalizeForGeocode("214 Grand St, Apt 4B, Brooklyn, NY 11211")).toBe(
      "214 Grand St, Brooklyn, NY 11211",
    );
  });

  it("leaves a street number that merely looks like a unit alone", () => {
    expect(normalizeForGeocode("4 Times Sq")).toBe("4 Times Sq, New York, NY");
    expect(normalizeForGeocode("1 Wall St")).toBe("1 Wall St, New York, NY");
  });
});

describe("normalizeForGeocode — anchoring", () => {
  it("appends the city when the address does not say where it is", () => {
    expect(normalizeForGeocode("350 5th Ave")).toBe("350 5th Ave, New York, NY");
  });

  it("leaves a borough alone", () => {
    expect(normalizeForGeocode("350 5th Ave, Brooklyn")).toBe("350 5th Ave, Brooklyn");
    expect(normalizeForGeocode("21-45 44th Dr, Queens")).toBe("21-45 44th Dr, Queens");
  });

  it("leaves a state or a zip alone", () => {
    expect(normalizeForGeocode("350 5th Ave, New York, NY")).toBe("350 5th Ave, New York, NY");
    expect(normalizeForGeocode("350 5th Ave, NY 10118")).toBe("350 5th Ave, NY 10118");
    expect(normalizeForGeocode("350 5th Ave 10118")).toBe("350 5th Ave 10118");
  });

  it("is case-insensitive about it", () => {
    expect(normalizeForGeocode("350 5th ave, brooklyn")).toBe("350 5th ave, brooklyn");
  });
});

describe("normalizeForGeocode — tidying", () => {
  it("collapses whitespace and stray commas", () => {
    expect(normalizeForGeocode("  214   Grand   St ,  #4B  ")).toBe(
      "214 Grand St, New York, NY",
    );
    expect(normalizeForGeocode("214 Grand St,,")).toBe("214 Grand St, New York, NY");
  });

  it("is empty for nothing", () => {
    expect(normalizeForGeocode("")).toBe("");
    expect(normalizeForGeocode("   ")).toBe("");
    expect(normalizeForGeocode("#4B")).toBe("");
  });
});

describe("notes", () => {
  it("records the provider a pin came from", () => {
    expect(
      geocodeNote({
        lat: 40.7,
        lng: -73.9,
        source: "nyc-geosearch",
        confidence: 0.95,
        lowConfidence: false,
        borough: "Brooklyn",
      }),
    ).toBe("nyc-geosearch");
  });

  it("flags a guess so the detail page can say 'check pin'", () => {
    expect(
      geocodeNote({
        lat: 40.7,
        lng: -73.9,
        source: "nominatim",
        confidence: null,
        lowConfidence: true,
        borough: null,
      }),
    ).toBe("low-confidence (nominatim)");
  });

  it("writes a failure down in the same column", () => {
    const note = geocodeFailureNote(
      new GeocodeError("not_found", "Couldn't find that address in New York."),
    );
    expect(note).toBe("failed: Couldn't find that address in New York.");
    expect(geocodeFailureNote(new Error("boom"))).toMatch(/^failed: /);
  });
});
