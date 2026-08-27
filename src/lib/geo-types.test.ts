import { describe, expect, it } from "vitest";
import {
  commuteMinutes,
  emptyCommutes,
  geocodeFailure,
  isFresh,
  mapsDirectionsUrl,
  pinStatus,
  COMMUTE_MAX_AGE_MS,
  ERROR_MAX_AGE_MS,
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

describe("ERROR_MAX_AGE_MS", () => {
  it("is one hour — a failure is not an answer worth keeping for a month", () => {
    expect(ERROR_MAX_AGE_MS).toBe(60 * 60 * 1000);
  });
});

describe("isFresh", () => {
  const NOW = Date.parse("2025-06-15T12:00:00Z");
  const ago = (ms: number) => new Date(NOW - ms).toISOString();
  const MINUTE = 60 * 1000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;

  it("keeps a real answer for thirty days", () => {
    expect(isFresh({ computed_at: ago(29 * DAY), error: null }, NOW)).toBe(true);
    expect(isFresh({ computed_at: ago(DAY), error: null }, NOW)).toBe(true);
  });

  it("lets a real answer go at thirty days", () => {
    expect(isFresh({ computed_at: ago(30 * DAY), error: null }, NOW)).toBe(false);
    expect(isFresh({ computed_at: ago(31 * DAY), error: null }, NOW)).toBe(false);
  });

  it("keeps an errored row for an hour and no longer", () => {
    // The reason a pair failed is nearly always transient or fixed from
    // outside the app — a key restriction, billing, a 429, a preview's
    // dry-run. Thirty days of that is an em dash nobody can clear.
    expect(isFresh({ computed_at: ago(59 * MINUTE), error: "Google took too long." }, NOW)).toBe(
      true,
    );
    expect(isFresh({ computed_at: ago(HOUR), error: "Google took too long." }, NOW)).toBe(false);
    expect(isFresh({ computed_at: ago(2 * HOUR), error: "No route." }, NOW)).toBe(false);
  });

  it("re-asks a day-old dry-run row, which a thirty-day TTL would have pinned", () => {
    expect(
      isFresh({ computed_at: ago(DAY), error: "dry-run (non-production)" }, NOW),
    ).toBe(false);
  });

  it("treats a row that was never really computed as stale", () => {
    expect(isFresh({ computed_at: null, error: null }, NOW)).toBe(false);
    expect(isFresh({ computed_at: "", error: null }, NOW)).toBe(false);
    expect(isFresh({ computed_at: "not a date", error: null }, NOW)).toBe(false);
    expect(isFresh({}, NOW)).toBe(false);
  });

  it("does not spend money over a clock disagreement", () => {
    // A stamp in the future is somebody's clock, not a reason to re-buy a row.
    expect(isFresh({ computed_at: new Date(NOW + DAY).toISOString(), error: null }, NOW)).toBe(
      true,
    );
  });

  it("reads an empty-string error as no error at all", () => {
    // PostgREST hands back exactly what is in the column; `''` is not a stored
    // failure, and treating it as one would re-buy the row every hour.
    expect(isFresh({ computed_at: ago(2 * HOUR), error: "" }, NOW)).toBe(true);
  });
});

describe("pinStatus", () => {
  it("is placed when there are coordinates and nothing to worry about", () => {
    expect(pinStatus({ lat: 40.7, lng: -73.9, geocode_note: "nyc-geosearch" })).toBe("placed");
    expect(pinStatus({ lat: 40.7, lng: -73.9, geocode_note: "manual" })).toBe("placed");
    expect(pinStatus({ lat: 40.7, lng: -73.9, geocode_note: null })).toBe("placed");
  });

  it("asks for a human glance when the match was a guess", () => {
    expect(
      pinStatus({ lat: 40.7, lng: -73.9, geocode_note: "low-confidence (nyc-geosearch)" }),
    ).toBe("check");
    expect(pinStatus({ lat: 40.7, lng: -73.9, geocode_note: "Low-Confidence (nominatim)" })).toBe(
      "check",
    );
  });

  it("tells 'we looked and failed' apart from 'nobody has looked'", () => {
    expect(pinStatus({ lat: null, lng: null, geocode_note: "failed: no match" })).toBe("failed");
    expect(pinStatus({ lat: null, lng: null, geocode_note: null })).toBe("unplaced");
    expect(pinStatus({ lat: null, lng: null, geocode_note: "   " })).toBe("unplaced");
    // Half a pin is no pin.
    expect(pinStatus({ lat: 40.7, lng: null, geocode_note: null })).toBe("unplaced");
  });

  it("reads an empty row as unplaced rather than throwing", () => {
    expect(pinStatus({})).toBe("unplaced");
  });
});

describe("geocodeFailure", () => {
  it("unwraps the provider's reason", () => {
    expect(geocodeFailure("failed: no match in NYC or OSM")).toBe("no match in NYC or OSM");
    expect(geocodeFailure("failed:")).toBe("No provider could place it.");
  });

  it("is null for a note that is not a failure", () => {
    expect(geocodeFailure("nyc-geosearch")).toBeNull();
    expect(geocodeFailure(null)).toBeNull();
    expect(geocodeFailure(undefined)).toBeNull();
  });
});
