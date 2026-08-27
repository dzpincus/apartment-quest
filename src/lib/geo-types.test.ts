import { describe, expect, it } from "vitest";
import {
  commuteMinutes,
  emptyCommutes,
  mapsDirectionsUrl,
  COMMUTE_MAX_AGE_MS,
} from "./geo-types";

const LISTING = { lat: 40.7173, lng: -73.95687 };
const WORK = { lat: 40.73507, lng: -73.99042 };

describe("commuteMinutes", () => {
  it("rounds seconds to minutes", () => {
    expect(commuteMinutes(1_260)).toBe("21 min");
    expect(commuteMinutes(90)).toBe("2 min");
  });

  it("never prints zero for a real journey", () => {
    expect(commuteMinutes(20)).toBe("1 min");
  });

  it("is an em dash for a pair with no answer", () => {
    expect(commuteMinutes(null)).toBe("—");
    expect(commuteMinutes(undefined)).toBe("—");
    expect(commuteMinutes(0)).toBe("—");
    expect(commuteMinutes(Number.NaN)).toBe("—");
  });
});

describe("mapsDirectionsUrl", () => {
  it("builds a keyless deep link with the right mode", () => {
    const url = new URL(mapsDirectionsUrl(LISTING, WORK, "transit"));
    expect(url.origin + url.pathname).toBe("https://www.google.com/maps/dir/");
    expect(url.searchParams.get("api")).toBe("1");
    expect(url.searchParams.get("origin")).toBe("40.7173,-73.95687");
    expect(url.searchParams.get("destination")).toBe("40.73507,-73.99042");
    expect(url.searchParams.get("travelmode")).toBe("transit");
  });

  it("uses Google Maps' own words for the other two modes", () => {
    // Not the Routes API's WALK / BICYCLE — a different product, a different
    // vocabulary, and `bike` here would silently open driving directions.
    expect(new URL(mapsDirectionsUrl(LISTING, WORK, "walk")).searchParams.get("travelmode")).toBe(
      "walking",
    );
    expect(new URL(mapsDirectionsUrl(LISTING, WORK, "bike")).searchParams.get("travelmode")).toBe(
      "bicycling",
    );
  });
});

describe("emptyCommutes", () => {
  it("is a factory, not a shared constant", () => {
    const a = emptyCommutes();
    const b = emptyCommutes();
    a.rows.push({
      listing_id: "x",
      location_id: "y",
      mode: "walk",
      seconds: 1,
      meters: 1,
      computed_at: null,
      error: null,
    });
    expect(b.rows).toHaveLength(0);
  });
});

describe("COMMUTE_MAX_AGE_MS", () => {
  it("is thirty days", () => {
    expect(COMMUTE_MAX_AGE_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });
});
