import { describe, expect, it } from "vitest";
import { addDays, fmtNY, todayNY, tomorrowNY } from "./time";

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

describe("addDays / tomorrowNY", () => {
  it("does calendar arithmetic across month and DST boundaries", () => {
    expect(addDays("2025-08-31", 1)).toBe("2025-09-01");
    expect(addDays("2025-11-02", 1)).toBe("2025-11-03");
    expect(addDays("2025-03-09", -1)).toBe("2025-03-08");
  });

  it("defaults a due date to the next New York day", () => {
    // 2025-03-10T02:30:00Z is still March 9th in New York.
    expect(tomorrowNY(new Date("2025-03-10T02:30:00Z"))).toBe("2025-03-10");
  });
});
