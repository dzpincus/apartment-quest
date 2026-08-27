import { describe, expect, it } from "vitest";
import {
  GOOGLE_TRAVEL_MODE,
  nextWeekdayNineAmNY,
  parseDurationSeconds,
  routeErrorMessage,
} from "./routes";

/**
 * The network half of this module is Google's server; what is testable — and
 * what has the bugs in it — is the departure time. It decides whether two
 * listings' transit numbers are comparable, and it is the one calculation in
 * the app that has to survive both a weekend and a DST change.
 *
 * New York is UTC-4 in August (EDT) and UTC-5 in January (EST), so 9:00 NY is
 * 13:00Z in summer and 14:00Z in winter.
 */

const at = (iso: string) => new Date(iso);

describe("nextWeekdayNineAmNY", () => {
  it("takes today when it is a weekday morning before nine", () => {
    // Wednesday 07:00 New York.
    expect(nextWeekdayNineAmNY(at("2026-08-26T11:00:00Z"))).toBe("2026-08-26T13:00:00.000Z");
  });

  it("takes tomorrow once nine has passed", () => {
    // Wednesday 10:00 New York -> Thursday.
    expect(nextWeekdayNineAmNY(at("2026-08-26T14:00:00Z"))).toBe("2026-08-27T13:00:00.000Z");
  });

  it("jumps Friday afternoon to Monday", () => {
    // Friday 14:00 New York.
    expect(nextWeekdayNineAmNY(at("2026-08-28T18:00:00Z"))).toBe("2026-08-31T13:00:00.000Z");
  });

  it("keeps Friday morning on Friday", () => {
    // Friday 08:00 New York — still before the rush hour it is aiming at.
    expect(nextWeekdayNineAmNY(at("2026-08-28T12:00:00Z"))).toBe("2026-08-28T13:00:00.000Z");
  });

  it("sends Saturday to Monday, early or late", () => {
    expect(nextWeekdayNineAmNY(at("2026-08-29T12:00:00Z"))).toBe("2026-08-31T13:00:00.000Z");
    expect(nextWeekdayNineAmNY(at("2026-08-29T23:00:00Z"))).toBe("2026-08-31T13:00:00.000Z");
  });

  it("sends Sunday to Monday", () => {
    expect(nextWeekdayNineAmNY(at("2026-08-30T16:00:00Z"))).toBe("2026-08-31T13:00:00.000Z");
  });

  it("is 14:00Z in winter, because New York moved and the hour did not", () => {
    // Wednesday 2027-01-06, 07:00 New York (EST).
    expect(nextWeekdayNineAmNY(at("2027-01-06T12:00:00Z"))).toBe("2027-01-06T14:00:00.000Z");
    // Friday 2027-01-08 afternoon -> Monday the 11th.
    expect(nextWeekdayNineAmNY(at("2027-01-08T20:00:00Z"))).toBe("2027-01-11T14:00:00.000Z");
  });

  it("uses New York's day, not UTC's", () => {
    // Friday 23:00 New York is already Saturday in UTC; the answer is still
    // Monday, and it is still Monday the 31st.
    expect(nextWeekdayNineAmNY(at("2026-08-29T03:00:00Z"))).toBe("2026-08-31T13:00:00.000Z");
  });

  it("is always in the future — Google refuses a departure in the past", () => {
    for (const iso of [
      "2026-08-26T11:00:00Z",
      "2026-08-26T14:00:00Z",
      "2026-08-28T18:00:00Z",
      "2026-08-29T12:00:00Z",
      "2026-08-30T16:00:00Z",
      "2027-01-06T12:00:00Z",
    ]) {
      expect(Date.parse(nextWeekdayNineAmNY(at(iso)))).toBeGreaterThan(Date.parse(iso));
    }
  });

  it("never lands on a weekend", () => {
    const start = Date.parse("2026-08-24T00:00:00Z");
    for (let hour = 0; hour < 24 * 21; hour += 1) {
      const answer = new Date(nextWeekdayNineAmNY(new Date(start + hour * 3_600_000)));
      // 13:00Z / 14:00Z are both a weekday in UTC when it is 09:00 in New York.
      expect(answer.getUTCDay()).toBeGreaterThan(0);
      expect(answer.getUTCDay()).toBeLessThan(6);
    }
  });
});

describe("parseDurationSeconds", () => {
  it("reads Google's protobuf duration string", () => {
    expect(parseDurationSeconds("1234s")).toBe(1234);
    expect(parseDurationSeconds("0s")).toBe(0);
    expect(parseDurationSeconds("1234.5s")).toBe(1235);
    expect(parseDurationSeconds(" 90s ")).toBe(90);
  });

  it("takes a plain number too", () => {
    expect(parseDurationSeconds(600)).toBe(600);
  });

  it("is null for anything else", () => {
    expect(parseDurationSeconds(undefined)).toBeNull();
    expect(parseDurationSeconds(null)).toBeNull();
    expect(parseDurationSeconds("1234")).toBeNull();
    expect(parseDurationSeconds("soon")).toBeNull();
    expect(parseDurationSeconds({})).toBeNull();
  });
});

describe("routeErrorMessage", () => {
  it("prefers Google's own sentence", () => {
    expect(routeErrorMessage(400, { error: { message: "Invalid travel mode." } })).toBe(
      "Invalid travel mode.",
    );
  });

  it("explains a 403 in terms of the thing that is actually wrong", () => {
    expect(routeErrorMessage(403, null)).toMatch(/billing|restrictions/i);
  });

  it("has something to say about every status", () => {
    expect(routeErrorMessage(400, null)).toBeTruthy();
    expect(routeErrorMessage(429, null)).toMatch(/rate-limited/i);
    expect(routeErrorMessage(500, null)).toContain("500");
  });
});

describe("GOOGLE_TRAVEL_MODE", () => {
  it("maps our three modes onto theirs", () => {
    expect(GOOGLE_TRAVEL_MODE).toEqual({
      walk: "WALK",
      bike: "BICYCLE",
      transit: "TRANSIT",
    });
  });
});
