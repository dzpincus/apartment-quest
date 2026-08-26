import { describe, expect, it } from "vitest";
import {
  bucketListings,
  COLD_AFTER_MS,
  coldFor,
  dayMs,
  daysBetween,
  dueHint,
  needsAttentionCount,
  type QueueFields,
} from "./queue";
import type { ListingStatus } from "./types";

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

  it("switches unit at exactly 48 hours", () => {
    const at = (h: number) =>
      coldFor(new Date(NOW.getTime() - h * 3_600_000).toISOString(), NOW);
    expect(at(47)).toBe("47h quiet");
    expect(at(48)).toBe("2d quiet");
    expect(at(49)).toBe("2d quiet");
  });

  it("floors partial hours rather than rounding up", () => {
    const at = (ms: number) => coldFor(new Date(NOW.getTime() - ms).toISOString(), NOW);
    expect(at(3_599_999)).toBe("0h quiet");
    expect(at(3_600_000)).toBe("1h quiet");
    expect(at(24 * 3_600_000 + 59 * 60_000)).toBe("24h quiet");
  });

  it("says nothing useful for an unparseable timestamp", () => {
    expect(coldFor("not-a-timestamp", NOW)).toBe("");
  });
});

describe("dayMs", () => {
  it("is calendar math, so a DST day is still exactly one day wide", () => {
    expect(dayMs("2026-03-09") - dayMs("2026-03-08")).toBe(86_400_000);
    expect(dayMs("2026-11-02") - dayMs("2026-11-01")).toBe(86_400_000);
  });

  it("ignores anything after the date part", () => {
    expect(dayMs("2026-03-08T23:59:59Z")).toBe(dayMs("2026-03-08"));
  });

  it("is NaN for a day it cannot parse, which is how bad rows stay unbucketed", () => {
    expect(dayMs("nope")).toBeNaN();
    expect(dayMs("")).toBeNaN();
    expect(dayMs("03/08/2026")).toBeNaN();
  });
});

/**
 * The queue compares `yyyy-MM-dd` strings turned into UTC midnights, so a
 * 23-hour or 25-hour New York day must not move a boundary. If any of this
 * ever regressed, every listing due on a DST Sunday would silently jump a
 * bucket.
 */
describe("bucketListings — DST transition days in America/New_York", () => {
  const dstCases = [
    { label: "spring forward", today: "2026-03-08", prev: "2026-03-07", next: "2026-03-09" },
    { label: "fall back", today: "2026-11-01", prev: "2026-10-31", next: "2026-11-02" },
  ];

  for (const { label, today, prev, next } of dstCases) {
    it(`buckets by calendar day on the ${label} day (${today})`, () => {
      // Noon New York on the transition day, in UTC.
      const now = new Date(`${today}T16:00:00Z`);
      const b = bucketListings(
        [
          listing({ id: "prev", next_action_due: prev, next_action: "Call" }),
          listing({ id: "today", next_action_due: today, next_action: "Call" }),
          listing({ id: "next", next_action_due: next, next_action: "Call" }),
        ],
        { todayNY: today, now },
      );
      expect(ids(b.overdue)).toEqual(["prev"]);
      expect(ids(b.today)).toEqual(["today"]);
      expect(ids(b.cold)).toEqual([]);
    });

    it(`still buckets correctly late on the ${label} day`, () => {
      // 23:30 New York on the transition day.
      const now = new Date(`${next}T0${label === "spring forward" ? "3" : "4"}:30:00Z`);
      const b = bucketListings(
        [listing({ id: "today", next_action_due: today, next_action: "Call" })],
        { todayNY: today, now },
      );
      expect(ids(b.today)).toEqual(["today"]);
      expect(ids(b.overdue)).toEqual([]);
    });

    it(`counts the ${label} day as one day of silence, not 23 or 25 hours`, () => {
      expect(daysBetween(prev, next)).toBe(2);
      expect(daysBetween(today, next)).toBe(1);
      expect(dueHint(prev, today)).toBe("1d overdue");
      expect(dueHint(next, today)).toBe("tomorrow");
    });
  }

  it("does not let the 25-hour fall-back day stretch the cold window", () => {
    // The cold cutoff is 24h of real elapsed time, not one calendar day, so
    // the extra hour on 2026-11-01 must not change who is cold.
    const now = new Date("2026-11-02T16:00:00Z");
    const rows = [
      listing({
        id: "quiet-23h",
        status: "contacted",
        last_contacted_at: new Date(now.getTime() - 23 * 3_600_000).toISOString(),
      }),
      listing({
        id: "quiet-25h",
        status: "contacted",
        last_contacted_at: new Date(now.getTime() - 25 * 3_600_000).toISOString(),
      }),
    ];
    const b = bucketListings(rows, { todayNY: "2026-11-02", now });
    expect(ids(b.cold)).toEqual(["quiet-25h"]);
  });
});

describe("bucketListings — the 24h cold boundary", () => {
  const cold = (offsetMs: number) =>
    bucketListings(
      [
        listing({
          id: "x",
          status: "contacted",
          last_contacted_at: new Date(NOW.getTime() - offsetMs).toISOString(),
        }),
      ],
      { todayNY: TODAY, now: NOW },
    ).cold;

  it("is exclusive at exactly 24 hours: the boundary itself is not yet cold", () => {
    // `last < now - 24h` — equality fails, so a listing contacted exactly one
    // day ago gets the rest of that final millisecond.
    expect(ids(cold(COLD_AFTER_MS))).toEqual([]);
    expect(ids(cold(COLD_AFTER_MS - 1))).toEqual([]);
    expect(ids(cold(COLD_AFTER_MS + 1))).toEqual(["x"]);
  });

  it("uses `now`, not the New York calendar day", () => {
    // Contacted at 15:00 NY yesterday, and it is 14:00 NY today: that is 23
    // hours, so it is not cold even though the calendar day has flipped.
    const now = new Date("2025-08-27T18:00:00Z");
    const b = bucketListings(
      [
        listing({
          id: "yesterday-afternoon",
          status: "contacted",
          last_contacted_at: "2025-08-26T19:00:00Z",
        }),
      ],
      { todayNY: "2025-08-27", now },
    );
    expect(ids(b.cold)).toEqual([]);
  });
});

describe("bucketListings — a due date without a next action", () => {
  it("still buckets on the date alone, since the date is the commitment", () => {
    const b = bucket([
      listing({ id: "overdue-no-action", next_action_due: "2025-08-26" }),
      listing({ id: "today-no-action", next_action_due: TODAY }),
      listing({ id: "future-no-action", next_action_due: "2025-09-30" }),
    ]);
    expect(ids(b.overdue)).toEqual(["overdue-no-action"]);
    expect(ids(b.today)).toEqual(["today-no-action"]);
    expect(ids(b.cold)).toEqual([]);
  });

  it("keeps a stale contacted listing out of Cold whenever any due date exists", () => {
    // SPEC: any due date at all means somebody already scheduled this.
    const longAgo = "2025-01-01T00:00:00Z";
    const b = bucket([
      listing({
        id: "future-due",
        status: "contacted",
        last_contacted_at: longAgo,
        next_action_due: "2025-12-31",
      }),
      listing({
        id: "no-due",
        status: "contacted",
        last_contacted_at: longAgo,
      }),
    ]);
    expect(ids(b.cold)).toEqual(["no-due"]);
    expect(ids(b.overdue)).toEqual([]);
    expect(ids(b.today)).toEqual([]);
  });

  it("falls back to the cold rules when the due date is unparseable", () => {
    const b = bucket([
      listing({
        id: "junk-due",
        status: "contacted",
        next_action_due: "whenever",
        last_contacted_at: "2025-01-01T00:00:00Z",
      }),
    ]);
    expect(ids(b.cold)).toEqual(["junk-due"]);
  });
});

describe("bucketListings — status precedence", () => {
  const ALIVE: ListingStatus[] = [
    "saved",
    "contacted",
    "tour_scheduled",
    "toured",
    "applied",
  ];
  const DEAD: ListingStatus[] = ["passed", "lost"];

  it("buckets an overdue listing in every live status", () => {
    for (const status of ALIVE) {
      const b = bucket([listing({ id: status, status, next_action_due: "2025-08-26" })]);
      expect(ids(b.overdue)).toEqual([status]);
    }
  });

  it("drops a listing in a dead status even when it is overdue", () => {
    for (const status of DEAD) {
      const b = bucket([listing({ id: status, status, next_action_due: "2025-08-26" })]);
      expect(ids(b.overdue)).toEqual([]);
      expect(ids(b.today)).toEqual([]);
      expect(ids(b.cold)).toEqual([]);
    }
  });

  it("only ever calls a `contacted` listing cold", () => {
    const longAgo = "2025-01-01T00:00:00Z";
    for (const status of ALIVE) {
      const b = bucket([listing({ id: status, status, last_contacted_at: longAgo })]);
      expect(ids(b.cold)).toEqual(status === "contacted" ? [status] : []);
    }
  });

  it("prefers overdue over today over cold for one and the same row", () => {
    // Overdue wins outright; the cold signals on the same row are ignored.
    const b = bucket([
      listing({
        id: "everything",
        status: "contacted",
        next_action_due: "2025-08-26",
        last_contacted_at: "2025-01-01T00:00:00Z",
      }),
    ]);
    expect(ids(b.overdue)).toEqual(["everything"]);
    expect(ids(b.today)).toEqual([]);
    expect(ids(b.cold)).toEqual([]);
  });

  it("lets merged_into beat every status, live or dead", () => {
    for (const status of [...ALIVE, ...DEAD]) {
      const b = bucket([
        listing({
          id: status,
          status,
          merged_into: "some-other-listing",
          next_action_due: "2025-08-26",
        }),
      ]);
      expect(needsAttentionCount(b)).toBe(0);
    }
  });

  it("treats a null status as live, so a half-written row is still chased", () => {
    const b = bucket([listing({ id: "null-status", status: null, next_action_due: TODAY })]);
    expect(ids(b.today)).toEqual(["null-status"]);
  });
});

describe("bucketListings — shape guarantees", () => {
  it("returns three empty buckets for an empty list", () => {
    expect(bucket([])).toEqual({ overdue: [], today: [], cold: [] });
    expect(needsAttentionCount(bucket([]))).toBe(0);
  });

  it("does not mutate or reorder the array it was given", () => {
    const rows = [
      listing({ id: "b", next_action_due: "2025-08-20" }),
      listing({ id: "a", next_action_due: "2025-08-10" }),
    ];
    const before = rows.map((r) => r.id);
    bucket(rows);
    expect(rows.map((r) => r.id)).toEqual(before);
  });

  it("hands back the same row objects, not copies", () => {
    const row = listing({ id: "a", next_action_due: TODAY });
    expect(bucket([row]).today[0]).toBe(row);
  });
});
