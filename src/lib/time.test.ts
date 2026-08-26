import { afterEach, describe, expect, it, vi } from "vitest";
import { addDays, fmtDay, fmtNY, nowNY, todayNY, tomorrowNY } from "./time";

/**
 * These tests are written to hold under *any* `TZ`. Run
 * `TZ=Asia/Tokyo pnpm test` (or `TZ=Pacific/Kiritimati`) to prove it: a
 * date-only helper that leans on the system zone fails there and nowhere else,
 * which is exactly how that class of bug reaches production.
 */

afterEach(() => {
  vi.useRealTimers();
});

describe("todayNY", () => {
  it("returns yyyy-MM-dd", () => {
    expect(todayNY()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("uses the New York day, not UTC", () => {
    // 2025-03-10T02:30:00Z is still March 9th in New York (21:30 EDT).
    expect(todayNY(new Date("2025-03-10T02:30:00Z"))).toBe("2025-03-09");
  });

  it("rolls over at New York midnight, not UTC midnight (EDT, UTC-4)", () => {
    // 04:00Z is exactly 00:00 EDT.
    expect(todayNY(new Date("2025-08-27T03:59:59.999Z"))).toBe("2025-08-26");
    expect(todayNY(new Date("2025-08-27T04:00:00.000Z"))).toBe("2025-08-27");
    // UTC has already flipped for hours by then; New York has not.
    expect(todayNY(new Date("2025-08-27T00:00:00.000Z"))).toBe("2025-08-26");
  });

  it("rolls over at New York midnight in winter too (EST, UTC-5)", () => {
    expect(todayNY(new Date("2025-01-15T04:59:59.999Z"))).toBe("2025-01-14");
    expect(todayNY(new Date("2025-01-15T05:00:00.000Z"))).toBe("2025-01-15");
  });

  it("crosses a month and a year boundary on New York's clock", () => {
    // New Year's Eve, 23:59 EST = 04:59Z on Jan 1. Still last year in NY.
    expect(todayNY(new Date("2026-01-01T04:59:00Z"))).toBe("2025-12-31");
    expect(todayNY(new Date("2026-01-01T05:00:00Z"))).toBe("2026-01-01");
    expect(todayNY(new Date("2025-09-01T03:00:00Z"))).toBe("2025-08-31");
  });

  it("survives the spring-forward day (2026-03-08, 02:00 -> 03:00 EDT)", () => {
    expect(todayNY(new Date("2026-03-08T04:59:00Z"))).toBe("2026-03-07"); // 23:59 EST
    expect(todayNY(new Date("2026-03-08T05:00:00Z"))).toBe("2026-03-08"); // 00:00 EST
    expect(todayNY(new Date("2026-03-08T07:30:00Z"))).toBe("2026-03-08"); // 03:30 EDT
    expect(todayNY(new Date("2026-03-09T03:59:00Z"))).toBe("2026-03-08"); // 23:59 EDT
    expect(todayNY(new Date("2026-03-09T04:00:00Z"))).toBe("2026-03-09");
  });

  it("survives the fall-back day (2026-11-01, 02:00 -> 01:00 EST)", () => {
    expect(todayNY(new Date("2026-11-01T03:59:00Z"))).toBe("2026-10-31"); // 23:59 EDT
    expect(todayNY(new Date("2026-11-01T04:00:00Z"))).toBe("2026-11-01"); // 00:00 EDT
    // 01:30 happens twice; both instants are still November 1st.
    expect(todayNY(new Date("2026-11-01T05:30:00Z"))).toBe("2026-11-01"); // 01:30 EDT
    expect(todayNY(new Date("2026-11-01T06:30:00Z"))).toBe("2026-11-01"); // 01:30 EST
    expect(todayNY(new Date("2026-11-02T04:59:00Z"))).toBe("2026-11-01"); // 23:59 EST
    expect(todayNY(new Date("2026-11-02T05:00:00Z"))).toBe("2026-11-02");
  });

  it("reads the mocked clock when called with no argument", () => {
    vi.useFakeTimers();
    // 03:30Z on the 27th is 23:30 EDT on the 26th.
    vi.setSystemTime(new Date("2025-08-27T03:30:00Z"));
    expect(todayNY()).toBe("2025-08-26");

    vi.setSystemTime(new Date("2025-08-27T04:30:00Z"));
    expect(todayNY()).toBe("2025-08-27");
  });
});

describe("fmtNY", () => {
  it("renders UTC input in New York time", () => {
    expect(fmtNY("2025-03-10T02:30:00Z", "yyyy-MM-dd HH:mm")).toBe("2025-03-09 22:30");
  });

  it("accepts a Date, an ISO string and an epoch number alike", () => {
    const iso = "2025-08-27T18:00:00Z";
    const expected = "2025-08-27 14:00";
    expect(fmtNY(new Date(iso), "yyyy-MM-dd HH:mm")).toBe(expected);
    expect(fmtNY(iso, "yyyy-MM-dd HH:mm")).toBe(expected);
    expect(fmtNY(Date.parse(iso), "yyyy-MM-dd HH:mm")).toBe(expected);
  });

  it("shows the offset change across the spring-forward gap", () => {
    // 06:59Z is 01:59 EST; one minute later the clock jumps to 03:00 EDT.
    expect(fmtNY("2026-03-08T06:59:00Z", "yyyy-MM-dd HH:mm")).toBe("2026-03-08 01:59");
    expect(fmtNY("2026-03-08T07:00:00Z", "yyyy-MM-dd HH:mm")).toBe("2026-03-08 03:00");
  });

  it("renders the repeated hour on the fall-back day at its two offsets", () => {
    expect(fmtNY("2026-11-01T05:30:00Z", "yyyy-MM-dd HH:mm")).toBe("2026-11-01 01:30");
    expect(fmtNY("2026-11-01T06:30:00Z", "yyyy-MM-dd HH:mm")).toBe("2026-11-01 01:30");
  });

  it("uses the default pattern when none is given", () => {
    expect(fmtNY("2025-08-27T18:05:00Z")).toBe("Aug 27, 2:05PM");
  });
});

describe("nowNY", () => {
  it("hands back a New York wall-clock date", () => {
    const d = nowNY(new Date("2025-08-27T18:00:00Z"));
    expect(d.getHours()).toBe(14);
    expect(d.getDate()).toBe(27);
  });
});

describe("fmtDay", () => {
  it("renders the day it was given, never the one before", () => {
    expect(fmtDay("2025-08-27")).toBe("Aug 27");
    expect(fmtDay("2025-08-27", "yyyy-MM-dd")).toBe("2025-08-27");
    expect(fmtDay("2025-08-27", "MMM d, yyyy")).toBe("Aug 27, 2025");
  });

  /**
   * Regression: `fmtDay` used to build `new TZDate("<day>T12:00:00", NY)`.
   * That string has plain `Date` semantics — the *system* zone parses it — so
   * on a device more than 12 hours ahead of New York (Tokyo, Sydney, Auckland)
   * local noon landed on the previous evening in New York and the helper
   * printed the wrong day. It also freezes into the `set_next_action` activity
   * summary, so the drift outlives the trip.
   */
  it("does not shift a day for any system timezone", () => {
    const days = [
      "2026-01-01",
      "2026-03-07",
      "2026-03-08", // spring forward
      "2026-03-09",
      "2026-06-15",
      "2026-10-31",
      "2026-11-01", // fall back
      "2026-11-02",
      "2026-12-31",
      "2024-02-29", // leap day
    ];
    for (const day of days) {
      expect(fmtDay(day, "yyyy-MM-dd")).toBe(day);
    }
  });

  it("agrees with the calendar on weekday names", () => {
    expect(fmtDay("2026-03-08", "EEEE")).toBe("Sunday");
    expect(fmtDay("2026-11-01", "EEEE")).toBe("Sunday");
    expect(fmtDay("2026-01-01", "EEEE")).toBe("Thursday");
  });

  it("is unaffected by the current clock", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    expect(fmtDay("2026-03-08", "yyyy-MM-dd")).toBe("2026-03-08");
  });

  it("tolerates a longer timestamp by using only the date part", () => {
    expect(fmtDay("2026-03-08T23:45:00Z", "yyyy-MM-dd")).toBe("2026-03-08");
  });

  it("returns unparseable input unchanged rather than throwing", () => {
    expect(() => fmtDay("")).not.toThrow();
    expect(fmtDay("")).toBe("");
    expect(fmtDay("not-a-day")).toBe("not-a-day");
    expect(fmtDay("08/27/2025")).toBe("08/27/2025");
  });
});

describe("addDays", () => {
  it("does calendar arithmetic across month and DST boundaries", () => {
    expect(addDays("2025-08-31", 1)).toBe("2025-09-01");
    expect(addDays("2025-11-02", 1)).toBe("2025-11-03");
    expect(addDays("2025-03-09", -1)).toBe("2025-03-08");
  });

  it("crosses a year end in both directions", () => {
    expect(addDays("2025-12-31", 1)).toBe("2026-01-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2025-12-25", 10)).toBe("2026-01-04");
    expect(addDays("2026-01-05", -10)).toBe("2025-12-26");
  });

  it("crosses every month end, including a leap February", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29"); // leap year
    expect(addDays("2024-02-29", 1)).toBe("2024-03-01");
    expect(addDays("2025-02-28", 1)).toBe("2025-03-01"); // not a leap year
    expect(addDays("2025-01-31", 1)).toBe("2025-02-01");
    expect(addDays("2025-04-30", 1)).toBe("2025-05-01");
    expect(addDays("2025-03-01", -1)).toBe("2025-02-28");
  });

  it("does not drift across a DST transition, in either direction", () => {
    // The point of doing this in UTC: a 23- or 25-hour local day is invisible.
    expect(addDays("2026-03-07", 1)).toBe("2026-03-08");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(addDays("2026-03-09", -1)).toBe("2026-03-08");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
    expect(addDays("2026-11-02", -1)).toBe("2026-11-01");
  });

  it("is a no-op for zero and composes over long spans", () => {
    expect(addDays("2025-08-27", 0)).toBe("2025-08-27");
    expect(addDays("2025-08-27", 365)).toBe("2026-08-27");
    expect(addDays(addDays("2025-08-27", 30), -30)).toBe("2025-08-27");
  });

  it("returns unparseable input unchanged", () => {
    expect(addDays("nope", 1)).toBe("nope");
    expect(addDays("", 1)).toBe("");
  });
});

describe("tomorrowNY", () => {
  it("defaults a due date to the next New York day", () => {
    // 2025-03-10T02:30:00Z is still March 9th in New York.
    expect(tomorrowNY(new Date("2025-03-10T02:30:00Z"))).toBe("2025-03-10");
  });

  it("advances from the New York day, not the UTC one", () => {
    // 03:30Z on the 27th is still the 26th in New York, so tomorrow is the 27th.
    expect(tomorrowNY(new Date("2025-08-27T03:30:00Z"))).toBe("2025-08-27");
    expect(tomorrowNY(new Date("2025-08-27T04:30:00Z"))).toBe("2025-08-28");
  });

  it("steps over a DST transition and a year end", () => {
    expect(tomorrowNY(new Date("2026-03-08T16:00:00Z"))).toBe("2026-03-09");
    expect(tomorrowNY(new Date("2026-11-01T16:00:00Z"))).toBe("2026-11-02");
    expect(tomorrowNY(new Date("2026-01-01T04:00:00Z"))).toBe("2026-01-01"); // still NYE
  });

  it("reads the mocked clock when called with no argument", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-12-31T18:00:00Z")); // 13:00 EST, Dec 31
    expect(tomorrowNY()).toBe("2026-01-01");
  });
});
