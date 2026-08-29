import { describe, expect, it } from "vitest";
import {
  buildThreadList,
  GLOBAL_THREAD_KEY,
  GLOBAL_THREAD_LABEL,
  listingIdFromThreadParam,
  threadHref,
  type ThreadListingLike,
  type ThreadSummaryLike,
} from "./threads";

const GRAND = "aaaaaaaa-0000-0000-0000-000000000001";
const BEDFORD = "bbbbbbbb-0000-0000-0000-000000000002";
const MERGED = "cccccccc-0000-0000-0000-000000000003";
const GHOST = "dddddddd-0000-0000-0000-000000000004";

const listing = (over: Partial<ThreadListingLike> & { id: string }): ThreadListingLike => ({
  address: "214 Grand St",
  unit: "4B",
  neighborhood: "Williamsburg",
  rent: 3200,
  merged_into: null,
  ...over,
});

const LISTINGS: ThreadListingLike[] = [
  listing({ id: GRAND }),
  listing({
    id: BEDFORD,
    address: "88 Bedford Ave",
    unit: null,
    neighborhood: "Bed-Stuy",
    rent: 4100,
  }),
  listing({ id: MERGED, merged_into: GRAND }),
];

const summary = (over: Partial<ThreadSummaryLike>): ThreadSummaryLike => ({
  listing_id: null,
  message_count: 1,
  last_at: "2026-08-20T12:00:00Z",
  last_body: "hi",
  last_person_id: "person-1",
  ...over,
});

describe("buildThreadList — the pinned group thread", () => {
  it("is present and first even with no messages at all", () => {
    const list = buildThreadList([], LISTINGS, null);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      key: GLOBAL_THREAD_KEY,
      listingId: null,
      label: GLOBAL_THREAD_LABEL,
      sublabel: null,
      lastAt: null,
      lastBody: null,
      messageCount: 0,
      unreadCount: 0,
    });
  });

  it("stays first even when a listing thread is newer", () => {
    const list = buildThreadList(
      [
        summary({ last_at: "2026-08-01T12:00:00Z" }),
        summary({ listing_id: GRAND, last_at: "2026-08-26T12:00:00Z" }),
      ],
      LISTINGS,
      null,
    );
    expect(list.map((t) => t.key)).toEqual([GLOBAL_THREAD_KEY, GRAND]);
  });

  it("carries its own count, snippet and last poster", () => {
    const [global] = buildThreadList(
      [
        summary({
          message_count: 12,
          last_body: "who is calling the broker",
          last_person_id: "person-9",
          last_at: "2026-08-26T12:00:00Z",
        }),
      ],
      [],
      null,
    );
    expect(global).toMatchObject({
      messageCount: 12,
      lastBody: "who is calling the broker",
      lastPersonId: "person-9",
      lastAt: "2026-08-26T12:00:00Z",
    });
  });
});

describe("buildThreadList — listing threads", () => {
  it("sorts by last message, newest first", () => {
    const list = buildThreadList(
      [
        summary({ listing_id: GRAND, last_at: "2026-08-01T12:00:00Z" }),
        summary({ listing_id: BEDFORD, last_at: "2026-08-26T12:00:00Z" }),
      ],
      LISTINGS,
      null,
    );
    expect(list.map((t) => t.key)).toEqual([GLOBAL_THREAD_KEY, BEDFORD, GRAND]);
  });

  it("sinks a thread with a missing or unparseable timestamp", () => {
    const list = buildThreadList(
      [
        summary({ listing_id: GRAND, last_at: null }),
        summary({ listing_id: BEDFORD, last_at: "2026-01-01T12:00:00Z" }),
      ],
      LISTINGS,
      null,
    );
    expect(list.map((t) => t.key)).toEqual([GLOBAL_THREAD_KEY, BEDFORD, GRAND]);
  });

  it("drops a merged listing", () => {
    const list = buildThreadList(
      [summary({ listing_id: MERGED }), summary({ listing_id: GRAND })],
      LISTINGS,
      null,
    );
    expect(list.map((t) => t.key)).toEqual([GLOBAL_THREAD_KEY, GRAND]);
  });

  it("drops a thread whose listing the caller does not have", () => {
    // `useListings()` fetches live rows only, so this is what a deleted or
    // merged-away listing looks like from here.
    const list = buildThreadList([summary({ listing_id: GHOST })], LISTINGS, null);
    expect(list.map((t) => t.key)).toEqual([GLOBAL_THREAD_KEY]);
  });

  it("labels the row like everywhere else and subtitles it with place and rent", () => {
    const list = buildThreadList(
      [summary({ listing_id: GRAND }), summary({ listing_id: BEDFORD })],
      LISTINGS,
      null,
    );
    expect(list[1]).toMatchObject({ label: "214 Grand St #4B", sublabel: "Williamsburg · $3,200" });
    expect(list[2]).toMatchObject({ label: "88 Bedford Ave", sublabel: "Bed-Stuy · $4,100" });
  });

  it("leaves the sublabel null when there is neither a neighborhood nor a rent", () => {
    const list = buildThreadList(
      [summary({ listing_id: GRAND })],
      [listing({ id: GRAND, neighborhood: null, rent: null })],
      null,
    );
    expect(list[1].sublabel).toBeNull();
  });
});

describe("buildThreadList — unread", () => {
  it("maps counts onto the right rows", () => {
    const list = buildThreadList(
      [
        summary({}),
        summary({ listing_id: GRAND }),
        summary({ listing_id: BEDFORD }),
      ],
      LISTINGS,
      { global: 3, byListing: { [GRAND]: 2 } },
    );
    expect(list.map((t) => [t.key, t.unreadCount])).toEqual([
      [GLOBAL_THREAD_KEY, 3],
      // Both listing threads share a timestamp, so the key breaks the tie.
      [GRAND, 2],
      [BEDFORD, 0],
    ]);
  });

  it("reads a missing or nonsense summary as nothing unread", () => {
    const list = buildThreadList([summary({ listing_id: GRAND })], LISTINGS, {
      global: null,
      byListing: { [GRAND]: -4 },
    });
    expect(list.map((t) => t.unreadCount)).toEqual([0, 0]);
  });
});

describe("the ?t= param", () => {
  it("treats absent and 'global' as the group thread", () => {
    expect(listingIdFromThreadParam(null)).toBeNull();
    expect(listingIdFromThreadParam("")).toBeNull();
    expect(listingIdFromThreadParam(GLOBAL_THREAD_KEY)).toBeNull();
  });

  it("passes a listing id through", () => {
    expect(listingIdFromThreadParam(GRAND)).toBe(GRAND);
  });

  it("round-trips through threadHref", () => {
    expect(listingIdFromThreadParam(new URL(threadHref(GRAND), "http://x").searchParams.get("t"))).toBe(
      GRAND,
    );
    expect(
      listingIdFromThreadParam(new URL(threadHref(null), "http://x").searchParams.get("t")),
    ).toBeNull();
  });
});
