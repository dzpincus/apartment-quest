import { describe, expect, it } from "vitest";
import { activityHref, type ActivityTarget } from "./activity";
import type { ActivityVerb } from "./types";

const LISTING = "aaaaaaaa-0000-0000-0000-000000000001";
const MESSAGE = "bbbbbbbb-0000-0000-0000-000000000002";
const BROKER = "cccccccc-0000-0000-0000-000000000003";

function item(over: Partial<ActivityTarget> = {}): ActivityTarget {
  return {
    verb: "added_listing",
    entity_type: "listing",
    entity_id: LISTING,
    ...over,
  };
}

describe("activityHref — listings", () => {
  it("points every listing verb at its listing", () => {
    const verbs: ActivityVerb[] = [
      "added_listing",
      "edited_listing",
      "changed_status",
      "voted",
      "logged_interaction",
      "set_next_action",
      "merged_listing",
      "added_photos",
      "listing_state_changed",
    ];
    for (const verb of verbs) {
      expect(activityHref(item({ verb }))).toBe(`/listings/${LISTING}`);
    }
  });

  it("sends a listing message to the thread, not the top of the page", () => {
    expect(activityHref(item({ verb: "messaged" }))).toBe(
      `/listings/${LISTING}#thread`,
    );
  });

  it("has nowhere to go when the listing id is missing", () => {
    expect(activityHref(item({ entity_id: null }))).toBeNull();
  });

  it("still finds the chat when a `messaged` row lost its listing id", () => {
    // Falls through the listing branch into the global one rather than
    // producing `/listings/null`.
    expect(activityHref(item({ verb: "messaged", entity_id: null }))).toBe("/chat");
  });
});

describe("activityHref — the group chat", () => {
  it("sends a global message to /chat", () => {
    // `postMessage` files these under the message's own id, which is not a route.
    expect(
      activityHref({
        verb: "messaged",
        entity_type: "message",
        entity_id: MESSAGE,
      }),
    ).toBe("/chat");
  });
});

describe("activityHref — brokers", () => {
  it("sends a new broker to the brokers page", () => {
    expect(
      activityHref({
        verb: "added_broker",
        entity_type: "broker",
        entity_id: BROKER,
      }),
    ).toBe("/brokers");
    // There is no per-broker route, so the id is deliberately ignored.
    expect(
      activityHref({ verb: "added_broker", entity_type: "broker", entity_id: null }),
    ).toBe("/brokers");
  });
});

describe("activityHref — nowhere to go", () => {
  it("returns null for a verb with no screen of its own", () => {
    expect(
      activityHref({
        verb: "updated_document",
        entity_type: "document",
        entity_id: "d1",
      }),
    ).toBeNull();
  });

  it("returns null for a row with no entity at all", () => {
    expect(
      activityHref({ verb: "edited_listing", entity_type: null, entity_id: null }),
    ).toBeNull();
  });

  it("does not follow a broker id onto a listing route", () => {
    expect(
      activityHref({ verb: "voted", entity_type: "broker", entity_id: BROKER }),
    ).toBeNull();
  });
});
