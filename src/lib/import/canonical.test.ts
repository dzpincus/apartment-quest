import { describe, expect, it } from "vitest";
import { canonicalListingUrl, isStreetEasyUnitPage, liveRentalPaths } from "./canonical";

const UNIT = "https://streeteasy.com/building/913-st-johns-place-brooklyn/1r";

describe("isStreetEasyUnitPage", () => {
  it("is true for a unit page", () => {
    expect(isStreetEasyUnitPage(UNIT)).toBe(true);
    expect(isStreetEasyUnitPage("https://www.streeteasy.com/building/x/4b")).toBe(true);
  });

  it("is false for a listing page — there is nothing left to canonicalise", () => {
    expect(isStreetEasyUnitPage("https://streeteasy.com/rental/5144148")).toBe(false);
    expect(isStreetEasyUnitPage("https://streeteasy.com/rental/5144148/")).toBe(false);
  });

  it("is false for every other site", () => {
    expect(isStreetEasyUnitPage("https://www.zillow.com/homedetails/x/1_zpid/")).toBe(false);
    expect(isStreetEasyUnitPage("not a url")).toBe(false);
  });
});

describe("canonicalListingUrl", () => {
  it("takes the site's own canonical link when it names a listing", () => {
    const html =
      '<head><link rel="canonical" href="https://streeteasy.com/rental/5144148/"/></head>';
    expect(canonicalListingUrl(UNIT, html)).toBe("https://streeteasy.com/rental/5144148");
  });

  it("ignores a canonical link that points back at the unit page", () => {
    // Which is what the real page does — hence the second rule below.
    const html = `<head><link rel="canonical" href="${UNIT}"/></head>`;
    expect(canonicalListingUrl(UNIT, html)).toBe(UNIT);
  });

  it("takes the one rental link that has a live status beside it", () => {
    const html = [
      '<a href="https://streeteasy.com/rental/5144148">See listing</a>',
      '<script>{\\"id\\":\\"5144148\\",\\"status\\":\\"AVAILABLE\\"}</script>',
    ].join("");
    expect(canonicalListingUrl(UNIT, html)).toBe("https://streeteasy.com/rental/5144148");
  });

  it("refuses a rental link that anything nearby calls dead", () => {
    const html = [
      '<a href="https://streeteasy.com/rental/4523362">Listed by ERNY LLC</a>',
      '<script>{\\"status\\":\\"ACTIVE\\"}</script>',
      '<a href="https://streeteasy.com/rental/4523362">No longer available</a>',
      '<script>{\\"status\\":\\"NO_LONGER_AVAILABLE\\"}</script>',
    ].join("");
    expect(canonicalListingUrl(UNIT, html)).toBe(UNIT);
  });

  /**
   * The shape of the page this whole change came from: a price-history table
   * where every `/rental/<id>` sits between an `ACTIVE` (the day it was listed)
   * and a `DELISTED` (the day it ended), and the *live* listing has no
   * `/rental/` link on the page at all. Every candidate is disqualified and the
   * pasted URL is kept — which is the right answer, not a missed one.
   */
  it("rewrites nothing on a page whose only rental links are history rows", () => {
    const row = (id: string, status: string, label: string) =>
      `{\\"status\\":\\"${status}\\",\\"listingUrl\\":\\"https://streeteasy.com/rental/${id}\\",\\"description\\":\\"${label}\\"}`;
    const html = [
      `<script>[${[
        row("4523362", "DELISTED", "Delisted by ERNY LLC"),
        row("4523362", "NO_LONGER_AVAILABLE", "No longer available"),
        row("4523362", "IN_CONTRACT", "In contract"),
        row("4523362", "ACTIVE", "Listed by ERNY LLC"),
        row("4333742", "DELISTED", "Delisted by ERNY LLC"),
        row("4333742", "ACTIVE", "Listed by ERNY LLC"),
      ].join(",")}]</script>`,
      '<script>{\\"id\\":\\"5144148\\",\\"status\\":\\"ACTIVE\\"}</script>',
    ].join("");
    expect(liveRentalPaths(html)).toEqual([]);
    expect(canonicalListingUrl(UNIT, html)).toBe(UNIT);
  });

  it("refuses to choose when two rental links both look live", () => {
    const html = [
      '<a href="https://streeteasy.com/rental/1">x</a><script>{\\"status\\":\\"ACTIVE\\"}</script>',
      '<a href="https://streeteasy.com/rental/2">y</a><script>{\\"status\\":\\"ACTIVE\\"}</script>',
    ].join("");
    expect(liveRentalPaths(html)).toEqual(["/rental/1", "/rental/2"]);
    expect(canonicalListingUrl(UNIT, html)).toBe(UNIT);
  });

  it("leaves a listing page, another site and an empty body alone", () => {
    const live =
      '<a href="https://streeteasy.com/rental/9">x</a><script>{"status":"ACTIVE"}</script>';
    expect(canonicalListingUrl("https://streeteasy.com/rental/5144148", live)).toBe(
      "https://streeteasy.com/rental/5144148",
    );
    expect(canonicalListingUrl("https://www.zillow.com/homedetails/x/1_zpid/", live)).toBe(
      "https://www.zillow.com/homedetails/x/1_zpid/",
    );
    expect(canonicalListingUrl(UNIT, "")).toBe(UNIT);
  });
});
