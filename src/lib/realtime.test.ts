import { describe, expect, it } from "vitest";
import { keysForChange } from "./realtime";
import { queryKeys } from "./queries";

/**
 * `RealtimeProvider` itself needs a socket and a QueryClient, so only the
 * routing decision is tested here — which is the part with the bugs in it.
 * Getting a key wrong shows up as a screen that quietly never refreshes, and
 * nothing in the type system catches that.
 */

const LISTING = "aaaaaaaa-0000-0000-0000-000000000001";
const OTHER = "bbbbbbbb-0000-0000-0000-000000000002";

/** `keysForChange` is typed to `Table`; this is how a test names a bad one. */
const unknownTable = "documents" as unknown as Parameters<typeof keysForChange>[0];

describe("keysForChange — messages", () => {
  it("refreshes one thread and the unread badges", () => {
    expect(keysForChange("messages", { id: "m1", listing_id: LISTING })).toEqual([
      queryKeys.thread(LISTING),
      queryKeys.unread,
    ]);
  });

  it("routes a global message to the global thread key", () => {
    expect(keysForChange("messages", { id: "m1", listing_id: null })).toEqual([
      queryKeys.thread(null),
      queryKeys.unread,
    ]);
    expect(keysForChange("messages", { id: "m1", listing_id: null })[0]).toEqual([
      "messages",
      "global",
    ]);
  });

  it("falls back to the whole prefix when a DELETE carries only the id", () => {
    // Default replica identity gives DELETE the primary key and nothing else,
    // so there is no way to tell which thread moved.
    expect(keysForChange("messages", { id: "m1" })).toEqual([
      queryKeys.messages,
      queryKeys.unread,
    ]);
  });

  it("uses the prefix when listing_id is present but not a string", () => {
    // `"listing_id" in row` is true, but `id()` refuses a non-string, so the
    // thread key resolves to the global thread rather than to garbage.
    expect(keysForChange("messages", { id: "m1", listing_id: 42 })).toEqual([
      queryKeys.thread(null),
      queryKeys.unread,
    ]);
  });

  it("always invalidates unread, whatever else it decides", () => {
    for (const row of [{ id: "m" }, { id: "m", listing_id: LISTING }, { listing_id: null }]) {
      expect(keysForChange("messages", row)).toContainEqual(queryKeys.unread);
    }
  });
});

describe("keysForChange — listings", () => {
  it("refreshes the table and the one detail page", () => {
    expect(keysForChange("listings", { id: LISTING })).toEqual([
      queryKeys.listings,
      queryKeys.listing(LISTING),
    ]);
  });

  it("refreshes only the table when the row has no usable id", () => {
    expect(keysForChange("listings", {})).toEqual([queryKeys.listings]);
    expect(keysForChange("listings", { id: null })).toEqual([queryKeys.listings]);
    expect(keysForChange("listings", { id: 7 })).toEqual([queryKeys.listings]);
  });

  it("puts the listings prefix first, which also covers the detail key", () => {
    // `["listings"]` is a prefix of `["listings", id]`, so the order is not
    // load-bearing — but the prefix must be there or the table goes stale.
    expect(keysForChange("listings", { id: LISTING })[0]).toEqual(queryKeys.listings);
  });
});

describe("keysForChange — activity", () => {
  it("refreshes the feed and nothing else, whatever the row looks like", () => {
    expect(keysForChange("activity", { id: "a1" })).toEqual([queryKeys.activity]);
    expect(keysForChange("activity", {})).toEqual([queryKeys.activity]);
    expect(keysForChange("activity", { listing_id: LISTING })).toEqual([queryKeys.activity]);
  });
});

describe("keysForChange — interactions", () => {
  it("refreshes the listing's history and the queue", () => {
    // `last_contacted_at` moves with an interaction, so the buckets are stale.
    expect(keysForChange("interactions", { id: "i1", listing_id: LISTING })).toEqual([
      queryKeys.interactions(LISTING),
      queryKeys.listings,
    ]);
  });

  it("refreshes only the queue when the listing is unknown", () => {
    expect(keysForChange("interactions", { id: "i1" })).toEqual([queryKeys.listings]);
    expect(keysForChange("interactions", { id: "i1", listing_id: null })).toEqual([
      queryKeys.listings,
    ]);
  });

  it("keys the history by the listing on the row, not some other one", () => {
    const [history] = keysForChange("interactions", { listing_id: OTHER });
    expect(history).toEqual(queryKeys.interactions(OTHER));
  });
});

describe("keysForChange — votes", () => {
  it("refreshes the vote key and the listings prefix", () => {
    // The prefix is what actually repaints: votes ride on the listing row and
    // `["listings"]` covers both the table and `["listings", id]`.
    expect(keysForChange("votes", { listing_id: LISTING, person_id: "p1" })).toEqual([
      queryKeys.votes(LISTING),
      queryKeys.listings,
    ]);
  });

  it("refreshes only the listings prefix when the row has no listing", () => {
    expect(keysForChange("votes", { person_id: "p1" })).toEqual([queryKeys.listings]);
    expect(keysForChange("votes", { listing_id: null })).toEqual([queryKeys.listings]);
  });
});

describe("keysForChange — brokers", () => {
  it("refreshes the broker list and every listing that embeds one", () => {
    // `LISTING_SELECT` embeds the broker columns, so a rename that only
    // invalidated `["brokers"]` would leave the old company on the table.
    expect(keysForChange("brokers", { id: "b1", name: "Ada" })).toEqual([
      queryKeys.brokers,
      queryKeys.listings,
    ]);
  });

  it("does not care what the row contains", () => {
    // Brokers are not keyed per-listing, so there is nothing to read off the
    // payload — a DELETE carrying only the primary key routes identically.
    expect(keysForChange("brokers", {})).toEqual([queryKeys.brokers, queryKeys.listings]);
    expect(keysForChange("brokers", { id: "b1" })).toEqual([
      queryKeys.brokers,
      queryKeys.listings,
    ]);
  });
});

describe("keysForChange — people", () => {
  it("refreshes the people key, which is the whole roster", () => {
    // Names, colours and incomes all hang off `["people"]`; `usePerson()` and
    // the qualification badge read from that one cache entry.
    expect(keysForChange("people", { id: "p1", name: "Ada" })).toEqual([queryKeys.people]);
    expect(keysForChange("people", {})).toEqual([queryKeys.people]);
  });

  it("uses the literal key the person provider queries", () => {
    // `peopleQueryOptions()` in person.tsx takes its key from the factory now,
    // so this is that one key spelled out. person.tsx is not imported here: it
    // pulls in the whole dialog tree, and these are pure-logic tests.
    expect(keysForChange("people", { id: "p1" })[0]).toEqual(["people"]);
  });

  it("does not drag the listings prefix along", () => {
    // Deliberate: a rename is rare and cheap to miss for a moment, and pulling
    // `["listings"]` in would refetch every listing on every income edit.
    expect(keysForChange("people", { id: "p1" })).not.toContainEqual(queryKeys.listings);
  });
});

describe("keysForChange — contract", () => {
  const TABLES = [
    "messages",
    "listings",
    "votes",
    "activity",
    "interactions",
    "brokers",
    "people",
  ] as const;

  it("returns at least one key for every table in the publication", () => {
    for (const table of TABLES) {
      const keys = keysForChange(table, { id: "x", listing_id: LISTING });
      expect(Array.isArray(keys)).toBe(true);
      expect(keys.length).toBeGreaterThan(0);
    }
  });

  it("returns an array for every table even when the row is empty", () => {
    // The caller does `for (const key of keysForChange(...))`, so `undefined`
    // here would throw inside the socket handler and kill the subscription.
    for (const table of TABLES) {
      expect(Array.isArray(keysForChange(table, {}))).toBe(true);
    }
  });

  it("returns no keys at all for a table it does not know", () => {
    expect(keysForChange(unknownTable, { id: "d1" })).toEqual([]);
    expect(keysForChange(unknownTable, {})).toEqual([]);
  });

  it("only ever emits keys the query-key factory could have produced", () => {
    const roots = new Set([
      "messages",
      "listings",
      "unread",
      "activity",
      "interactions",
      "votes",
      "brokers",
      "people",
    ]);
    for (const table of TABLES) {
      for (const row of [{}, { id: LISTING, listing_id: LISTING }, { listing_id: null }]) {
        for (const key of keysForChange(table, row)) {
          expect(roots).toContain((key as string[])[0]);
        }
      }
    }
  });
});
