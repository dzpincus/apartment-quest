import { describe, expect, it } from "vitest";
import {
  bucketListings,
  coldFor,
  daysBetween,
  dueHint,
  needsAttentionCount,
  type QueueFields,
} from "./queue";

const TODAY = "2025-08-27";
const NOW = new Date("2025-08-27T18:00:00Z"); // 14:00 in New York

/** A listing that is invisible to every bucket until a test opts it in. */
function listing(over: Partial<QueueFields> & { id: string }) {
  return {
    status: "saved" as const,
    merged_into: null,
    next_action: null,
    next_action_due: null,
    last_contacted_at: null,
    ...over,
  };
}

function ids(rows: ReadonlyArray<{ id: string }>) {
  return rows.map((r) => r.id);
}

function bucket(rows: ReadonlyArray<QueueFields & { id: string }>) {
  return bucketListings(rows, { todayNY: TODAY, now: NOW });
}

describe("bucketListings — due dates", () => {
  it("puts yesterday in overdue, today in today, and tomorrow in neither", () => {
    const rows = [
      listing({ id: "yesterday", next_action_due: "2025-08-26", next_action: "Call back" }),
      listing({ id: "today", next_action_due: TODAY, next_action: "Call back" }),
      listing({ id: "tomorrow", next_action_due: "2025-08-28", next_action: "Call back" }),
    ];
    const b = bucket(rows);
    expect(ids(b.overdue)).toEqual(["yesterday"]);
    expect(ids(b.today)).toEqual(["today"]);
    expect(ids(b.cold)).toEqual([]);
  });

  it("sorts overdue worst-first", () => {
    const b = bucket([
      listing({ id: "recent", next_action_due: "2025-08-26" }),
      listing({ id: "ancient", next_action_due: "2025-07-01" }),
      listing({ id: "middle", next_action_due: "2025-08-10" }),
    ]);
    expect(ids(b.overdue)).toEqual(["ancient", "middle", "recent"]);
  });

  it("does not double-count: a listing lands in at most one bucket", () => {
    const b = bucket([
      listing({
        id: "both",
        status: "contacted",
        next_action_due: "2025-08-26",
        last_contacted_at: "2025-08-01T00:00:00Z",
      }),
    ]);
    expect(ids(b.overdue)).toEqual(["both"]);
    expect(ids(b.cold)).toEqual([]);
  });

  it("ignores a due date on a listing whose day cannot be parsed", () => {
    const b = bucket([listing({ id: "junk", next_action_due: "not-a-date" })]);
    expect(ids(b.overdue)).toEqual([]);
    expect(ids(b.today)).toEqual([]);
  });
});

describe("bucketListings — cold", () => {
  const cold = (id: string, hoursAgo: number, over: Partial<QueueFields> = {}) =>
    listing({
      id,
      status: "contacted",
      last_contacted_at: new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString(),
      ...over,
    });

  it("is cold at 25h and not at 23h", () => {
    const b = bucket([cold("quiet", 25), cold("fresh", 23)]);
    expect(ids(b.cold)).toEqual(["quiet"]);
  });

  it("needs status = contacted", () => {
    const b = bucket([
      cold("contacted", 48),
      cold("toured", 48, { status: "toured" }),
      cold("saved", 48, { status: "saved" }),
    ]);
    expect(ids(b.cold)).toEqual(["contacted"]);
  });

  it("drops out once a next action exists, even with no due date", () => {
    const b = bucket([
      cold("planned", 48, { next_action: "Call back" }),
      cold("unplanned", 48),
    ]);
    expect(ids(b.cold)).toEqual(["unplanned"]);
  });

  it("treats a whitespace-only next action as no next action", () => {
    const b = bucket([cold("blank", 48, { next_action: "   " })]);
    expect(ids(b.cold)).toEqual(["blank"]);
  });

  it("skips a listing that was never contacted", () => {
    const b = bucket([listing({ id: "never", status: "contacted" })]);
    expect(ids(b.cold)).toEqual([]);
  });

  it("sorts the longest silence first", () => {
    const b = bucket([cold("day", 30), cold("week", 24 * 7), cold("twoDays", 50)]);
    expect(ids(b.cold)).toEqual(["week", "twoDays", "day"]);
  });
});

describe("bucketListings — exclusions", () => {
  it("excludes passed and lost from every bucket", () => {
    const b = bucket([
      listing({ id: "passed", status: "passed", next_action_due: "2025-08-26" }),
      listing({ id: "lost", status: "lost", next_action_due: TODAY }),
      listing({
        id: "passedCold",
        status: "passed",
        last_contacted_at: "2025-01-01T00:00:00Z",
      }),
    ]);
    expect(b).toEqual({ overdue: [], today: [], cold: [] });
  });

  it("excludes merged rows", () => {
    const b = bucket([
      listing({ id: "merged", merged_into: "other-id", next_action_due: "2025-08-26" }),
    ]);
    expect(ids(b.overdue)).toEqual([]);
  });
});

describe("needsAttentionCount", () => {
  it("counts overdue plus today, never cold", () => {
    const b = bucket([
      listing({ id: "a", next_action_due: "2025-08-26" }),
      listing({ id: "b", next_action_due: TODAY }),
      listing({
        id: "c",
        status: "contacted",
        last_contacted_at: "2025-08-01T00:00:00Z",
      }),
    ]);
    expect(needsAttentionCount(b)).toBe(2);
  });
});

describe("daysBetween / dueHint", () => {
  it("counts calendar days across a DST boundary", () => {
    expect(daysBetween("2025-11-01", "2025-11-03")).toBe(2);
    expect(daysBetween("2025-03-08", "2025-03-10")).toBe(2);
  });

  it("labels the distance from today", () => {
    expect(dueHint("2025-08-25", TODAY)).toBe("2d overdue");
    expect(dueHint("2025-08-26", TODAY)).toBe("1d overdue");
    expect(dueHint(TODAY, TODAY)).toBe("today");
    expect(dueHint("2025-08-28", TODAY)).toBe("tomorrow");
    expect(dueHint("2025-08-30", TODAY)).toBe("in 3d");
  });
});

describe("coldFor", () => {
  it("reports hours under two days and days after", () => {
    expect(coldFor(new Date(NOW.getTime() - 31 * 3_600_000).toISOString(), NOW)).toBe(
      "31h quiet",
    );
    expect(coldFor(new Date(NOW.getTime() - 72 * 3_600_000).toISOString(), NOW)).toBe(
      "3d quiet",
    );
    expect(coldFor(null, NOW)).toBe("never contacted");
  });
});
