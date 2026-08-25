import { describe, expect, it } from "vitest";
import { fmtNY, todayNY } from "./time";

describe("todayNY", () => {
  it("returns yyyy-MM-dd", () => {
    expect(todayNY()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("uses the New York day, not UTC", () => {
    // 2025-03-10T02:30:00Z is still March 9th in New York (21:30 EDT).
    expect(todayNY(new Date("2025-03-10T02:30:00Z"))).toBe("2025-03-09");
  });
});

describe("fmtNY", () => {
  it("renders UTC input in New York time", () => {
    expect(fmtNY("2025-03-10T02:30:00Z", "yyyy-MM-dd HH:mm")).toBe("2025-03-09 22:30");
  });
});
