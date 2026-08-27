import { describe, expect, it } from "vitest";
import { unreadSummary, type UnreadLike } from "./unread";

const A = "aaaaaaaa-0000-0000-0000-000000000001";
const B = "bbbbbbbb-0000-0000-0000-000000000002";
const C = "cccccccc-0000-0000-0000-000000000003";

function summary(over: Partial<UnreadLike> = {}): UnreadLike {
  return { global: 0, byListing: {}, ...over };
}

describe("unreadSummary", () => {
  it("is all zeros for a summary with nothing in it", () => {
    expect(unreadSummary(summary())).toEqual({ chatCount: 0, listingIds: [] });
  });

  it("survives the loading state, where there is no summary at all", () => {
    // `useUnread()` hands out `EMPTY_UNREAD` until the RPC lands, but the nav
    // renders on the very first paint and a throw there is a blank app.
    expect(unreadSummary(undefined)).toEqual({ chatCount: 0, listingIds: [] });
    expect(unreadSummary(null)).toEqual({ chatCount: 0, listingIds: [] });
    expect(unreadSummary({})).toEqual({ chatCount: 0, listingIds: [] });
  });

  it("counts the global thread as messages and listings as listings", () => {
    // The whole point of the split: 3 + 9 messages across two listings is
    // "2 listings", never "12".
    expect(
      unreadSummary(summary({ global: 4, byListing: { [A]: 3, [B]: 9 } })),
    ).toEqual({ chatCount: 4, listingIds: [A, B] });
  });

  it("drops listings whose count is zero", () => {
    // `unread_counts` can return a row of 0 for a thread that has been read.
    expect(
      unreadSummary(summary({ byListing: { [A]: 0, [B]: 2, [C]: 0 } })).listingIds,
    ).toEqual([B]);
  });

  it("keeps the RPC's order, so the one-listing deep link is stable", () => {
    expect(
      unreadSummary(summary({ byListing: { [C]: 1, [A]: 1, [B]: 1 } })).listingIds,
    ).toEqual([C, A, B]);
  });

  it("treats a negative or nonsense count as nothing unread", () => {
    const bad = {
      global: -3,
      byListing: { [A]: Number.NaN, [B]: -1 },
    } as unknown as UnreadLike;
    expect(unreadSummary(bad)).toEqual({ chatCount: 0, listingIds: [] });
  });

  it("truncates a bigint that arrived as a string", () => {
    // PostgREST hands `count(*)` back as a string on some versions; the fetcher
    // already coerces, but a badge must never render "3.0" or "NaN".
    const wire = { global: "3", byListing: { [A]: "2" } } as unknown as UnreadLike;
    expect(unreadSummary(wire)).toEqual({ chatCount: 3, listingIds: [A] });
  });

  it("does not mutate what it was given", () => {
    const input = summary({ global: 1, byListing: { [A]: 1 } });
    const before = JSON.stringify(input);
    unreadSummary(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});
