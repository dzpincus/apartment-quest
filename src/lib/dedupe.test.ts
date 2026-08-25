import { describe, expect, it } from "vitest";
import { dedupeKey, qualification } from "./dedupe";

describe("dedupeKey", () => {
  it("lowercases and strips everything but alphanumerics and the separator", () => {
    expect(dedupeKey("214 Grand St", "4B")).toBe("214grandst|4b");
  });

  it("ignores spacing, punctuation and case differences", () => {
    expect(dedupeKey("214 Grand St.", "#4B")).toBe(dedupeKey("214  grand st", "4b"));
    expect(dedupeKey("214-Grand_St", "Apt 4B")).toBe("214grandst|apt4b");
  });

  it("keeps the separator so address+unit never collides with address alone", () => {
    expect(dedupeKey("214 Grand St 4B", null)).toBe("214grandst4b|");
    expect(dedupeKey("214 Grand St", "4B")).toBe("214grandst|4b");
    expect(dedupeKey("214 Grand St 4B", null)).not.toBe(dedupeKey("214 Grand St", "4B"));
  });

  it("treats null, undefined and empty unit identically", () => {
    expect(dedupeKey("214 Grand St", null)).toBe("214grandst|");
    expect(dedupeKey("214 Grand St")).toBe("214grandst|");
    expect(dedupeKey("214 Grand St", "")).toBe("214grandst|");
    expect(dedupeKey("214 Grand St", "   ")).toBe("214grandst|");
  });

  it("handles a null address", () => {
    expect(dedupeKey(null, null)).toBe("|");
  });
});

describe("qualification", () => {
  const rent = 6000; // 40x => $240,000 combined

  it("uses 40x monthly rent, not 40x annual rent", () => {
    expect(qualification(rent, 40, []).required).toBe(240_000);
  });

  it("passes exactly at the boundary", () => {
    const q = qualification(rent, 40, [120_000, 120_000]);
    expect(q.combined).toBe(240_000);
    expect(q.passes).toBe(true);
    expect(q.ratio).toBe(1);
  });

  it("fails one dollar under", () => {
    expect(qualification(rent, 40, [120_000, 119_999]).passes).toBe(false);
  });

  it("sums all four incomes and tolerates nulls", () => {
    const q = qualification(3_200, 40, [90_000, 80_000, null, undefined]);
    expect(q.combined).toBe(170_000);
    expect(q.required).toBe(128_000);
    expect(q.passes).toBe(true);
  });

  it("defaults the multiplier to 40 when the listing has none", () => {
    expect(qualification(3_200, null, [0]).required).toBe(128_000);
  });

  it("honours a non-standard multiplier", () => {
    expect(qualification(3_200, 45, [0]).required).toBe(144_000);
  });

  it("is a no-op pass when rent is unknown", () => {
    const q = qualification(null, 40, [100_000]);
    expect(q.required).toBe(0);
    expect(q.passes).toBe(true);
    expect(q.ratio).toBe(1);
  });
});
