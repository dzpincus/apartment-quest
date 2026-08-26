import { describe, expect, it } from "vitest";
import { normalizeListingUrl } from "./url";

/**
 * The duplicate-import guard is an `eq` on this string, so every pair below
 * that should collapse to one listing has to come out byte-identical.
 */

describe("normalizeListingUrl", () => {
  it("lower-cases the host but not the path", () => {
    expect(normalizeListingUrl("https://StreetEasy.COM/building/X/4B")).toBe(
      "https://streeteasy.com/building/X/4B",
    );
  });

  it("drops the fragment", () => {
    expect(normalizeListingUrl("https://streeteasy.com/rental/123#photos")).toBe(
      "https://streeteasy.com/rental/123",
    );
  });

  it("drops utm_*, fbclid and gclid, keeping everything else", () => {
    expect(
      normalizeListingUrl(
        "https://zillow.com/homedetails/1?utm_source=email&utm_campaign=x&fbclid=abc&gclid=def&unit=4B",
      ),
    ).toBe("https://zillow.com/homedetails/1?unit=4B");
  });

  it("drops a query that was nothing but tracking", () => {
    expect(normalizeListingUrl("https://zillow.com/homedetails/1?utm_medium=cpc")).toBe(
      "https://zillow.com/homedetails/1",
    );
  });

  it("strips a trailing slash, including on the root", () => {
    expect(normalizeListingUrl("https://streeteasy.com/building/x/4b/")).toBe(
      "https://streeteasy.com/building/x/4b",
    );
    expect(normalizeListingUrl("https://streeteasy.com/")).toBe("https://streeteasy.com");
  });

  it("collapses the shapes one link arrives in", () => {
    const canonical = "https://streeteasy.com/building/x/4b";
    for (const variant of [
      "https://StreetEasy.com/building/x/4b/",
      "https://streeteasy.com/building/x/4b?utm_source=share#photos",
      "  https://streeteasy.com/building/x/4b  ",
    ]) {
      expect(normalizeListingUrl(variant)).toBe(canonical);
    }
  });

  it("keeps a non-default port and drops the default one", () => {
    expect(normalizeListingUrl("http://example.com:8080/a/")).toBe("http://example.com:8080/a");
    expect(normalizeListingUrl("https://example.com:443/a")).toBe("https://example.com/a");
  });

  it("hands back anything that is not an http(s) URL, trimmed", () => {
    expect(normalizeListingUrl("  not a url ")).toBe("not a url");
    expect(normalizeListingUrl("javascript:alert(1)")).toBe("javascript:alert(1)");
    expect(normalizeListingUrl("")).toBe("");
    expect(normalizeListingUrl(null)).toBe("");
    expect(normalizeListingUrl(undefined)).toBe("");
  });
});
