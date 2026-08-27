import { afterEach, describe, expect, it, vi } from "vitest";
import {
  geocodeAddress,
  geocodeFailureNote,
  geocodeNote,
  GeocodeError,
  nominatimEnabled,
  nominatimUserAgent,
  normalizeForGeocode,
} from "./geocode";

/**
 * Only the pure half is tested — the two providers are somebody else's servers
 * and mocking their JSON would test the mock. What *is* worth pinning is the
 * string we send them, because "214 Grand St #4B" and "214 Grand St" resolve to
 * different things, and a missing borough is the difference between Manhattan
 * and Brooklyn.
 *
 * The one network-shaped exception is rung two's `User-Agent`: whether we call
 * Nominatim anonymously is a policy question, not a JSON-parsing one, and the
 * answer has to be "never".
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


/**
 * Nominatim's usage policy wants a contact in the `User-Agent`, and this
 * repository is public — so the contact is configuration, and *missing*
 * configuration means the rung does not run. Calling them anonymously is the
 * thing that gets an app blocked, so "no contact" must never fall back to
 * "call anyway".
 */
describe("nominatimUserAgent", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
    vi.restoreAllMocks();
  });

  it("builds the header around whatever contact is configured", () => {
    process.env.NOMINATIM_CONTACT = "someone@example.com";
    expect(nominatimUserAgent()).toBe("apartment-quest (someone@example.com)");
    expect(nominatimEnabled()).toBe(true);

    // A repo URL is a contact too — Nominatim asks for a way to reach a human,
    // not specifically for an email address.
    process.env.NOMINATIM_CONTACT = "https://github.com/example/apartment-quest";
    expect(nominatimUserAgent()).toBe(
      "apartment-quest (https://github.com/example/apartment-quest)",
    );
  });

  it("trims, because a trailing newline in a header is a rejected request", () => {
    process.env.NOMINATIM_CONTACT = "  someone@example.com \n";
    expect(nominatimUserAgent()).toBe("apartment-quest (someone@example.com)");
  });

  it("is null when unset or blank, never a header with a hole in it", () => {
    delete process.env.NOMINATIM_CONTACT;
    expect(nominatimUserAgent()).toBeNull();
    expect(nominatimEnabled()).toBe(false);

    process.env.NOMINATIM_CONTACT = "   ";
    expect(nominatimUserAgent()).toBeNull();
    expect(nominatimEnabled()).toBe(false);
  });
});

/** A `Response` as far as `getJson` is concerned: ok, and some JSON. */
const jsonResponse = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as Response;

describe("the ladder without a Nominatim contact", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
    vi.restoreAllMocks();
  });

  it("stops after rung one and says why", async () => {
    delete process.env.NOMINATIM_CONTACT;
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ features: [] }));
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    await expect(geocodeAddress("350 5th Ave")).rejects.toThrow(GeocodeError);

    // One call, and it was NYC GeoSearch. Nominatim was never asked.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain("geosearch.planninglabs.nyc");
    expect(info).toHaveBeenCalledWith("[geocode] nominatim disabled: set NOMINATIM_CONTACT");
  });

  it("still reports not_found rather than a configuration error", async () => {
    delete process.env.NOMINATIM_CONTACT;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ features: [] }));
    vi.spyOn(console, "info").mockImplementation(() => {});

    // A missing fallback is not a thing to explain to whoever typed the
    // address: from where they sit, nobody could place it.
    await expect(geocodeAddress("350 5th Ave")).rejects.toMatchObject({
      reason: "not_found",
    });
  });
});

describe("the ladder with a Nominatim contact", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
    vi.restoreAllMocks();
  });

  it("falls through to rung two and identifies itself", async () => {
    process.env.NOMINATIM_CONTACT = "someone@example.com";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ features: [] }))
      .mockResolvedValueOnce(jsonResponse([{ lat: "40.7484", lon: "-73.9857" }]));

    const result = await geocodeAddress("350 5th Ave");

    expect(result.source).toBe("nominatim");
    expect(result.lowConfidence).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const init = fetchSpy.mock.calls[1]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe(
      "apartment-quest (someone@example.com)",
    );
  });
});
