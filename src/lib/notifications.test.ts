import { describe, expect, it } from "vitest";
import {
  hrefForMessage,
  isThreadOnScreen,
  NOTIFICATION_BODY_MAX,
  notificationBody,
  shouldNotify,
  threadTag,
  type NotifyPermission,
} from "./notifications";

const ME = "aaaaaaaa-0000-0000-0000-000000000001";
const THEM = "bbbbbbbb-0000-0000-0000-000000000002";
const GRAND = "cccccccc-0000-0000-0000-000000000003";

/** The happy path, so each test can name the one thing it changes. */
function ask(over: Partial<Parameters<typeof shouldNotify>[0]> = {}) {
  return shouldNotify({
    message: { person_id: THEM, listing_id: null, body: "hello" },
    myPersonId: ME,
    enabled: true,
    permission: "granted",
    visible: false,
    currentThreadOpen: false,
    ...over,
  });
}

describe("shouldNotify", () => {
  it("notifies for somebody else's message with the tab in the background", () => {
    expect(ask()).toBe(true);
  });

  it("never notifies for your own message", () => {
    expect(ask({ message: { person_id: ME, body: "hi" } })).toBe(false);
  });

  it("never notifies for a message with no author", () => {
    expect(ask({ message: { person_id: null, body: "hi" } })).toBe(false);
  });

  it("respects the device preference", () => {
    expect(ask({ enabled: false })).toBe(false);
  });

  it("respects the browser permission", () => {
    for (const permission of ["default", "denied", "unsupported"] as NotifyPermission[]) {
      expect(ask({ permission })).toBe(false);
    }
  });

  it("stays quiet about the thread already on screen", () => {
    expect(ask({ visible: true, currentThreadOpen: true })).toBe(false);
  });

  it("still notifies about another thread with the tab in front of you", () => {
    // A badge in a corner is the only other sign, and it is not enough.
    expect(ask({ visible: true, currentThreadOpen: false })).toBe(true);
  });

  it("notifies about the open thread when the tab is hidden", () => {
    // The thread is "open" in a tab nobody is looking at.
    expect(ask({ visible: false, currentThreadOpen: true })).toBe(true);
  });

  it("does not need to know who you are to refuse a disabled device", () => {
    expect(ask({ myPersonId: null, enabled: false })).toBe(false);
    expect(ask({ myPersonId: null })).toBe(true);
  });
});

describe("notificationBody", () => {
  it("says who and where for the group thread", () => {
    expect(notificationBody({ listing_id: null, body: "hi" }, "Reese", null)).toEqual({
      title: "Reese · Group chat",
      body: "hi",
      tag: "thread:global",
    });
  });

  it("names the listing for a listing thread", () => {
    expect(
      notificationBody({ listing_id: GRAND, body: "call them" }, "Dylan", "214 Grand St #4B"),
    ).toEqual({
      title: "Dylan · 214 Grand St #4B",
      body: "call them",
      tag: `thread:${GRAND}`,
    });
  });

  it("falls back rather than printing an empty title", () => {
    expect(notificationBody({ body: "x" }, null, "").title).toBe("Someone · Group chat");
    expect(notificationBody({ body: "x" }, "   ", null).title).toBe("Someone · Group chat");
  });

  it("truncates a long message with an ellipsis", () => {
    const long = "x".repeat(400);
    const { body } = notificationBody({ body: long }, "Reese", null);
    expect(body).toHaveLength(NOTIFICATION_BODY_MAX);
    expect(body.endsWith("…")).toBe(true);
  });

  it("leaves a message exactly at the limit alone", () => {
    const exact = "y".repeat(NOTIFICATION_BODY_MAX);
    expect(notificationBody({ body: exact }, "Reese", null).body).toBe(exact);
  });

  it("survives a message with no body", () => {
    expect(notificationBody({}, "Reese", null).body).toBe("");
  });
});

describe("threadTag", () => {
  it("collapses a burst to one banner per thread", () => {
    expect(threadTag(GRAND)).toBe(threadTag(GRAND));
    expect(threadTag(null)).toBe("thread:global");
    expect(threadTag(GRAND)).not.toBe(threadTag(null));
  });
});

describe("hrefForMessage", () => {
  it("lands on the right thread", () => {
    expect(hrefForMessage(GRAND)).toBe(`/chat?t=${GRAND}`);
    expect(hrefForMessage(null)).toBe("/chat?t=global");
    expect(hrefForMessage(undefined)).toBe("/chat?t=global");
  });
});

describe("isThreadOnScreen", () => {
  it("matches the open thread on /chat", () => {
    expect(isThreadOnScreen(GRAND, "/chat", GRAND)).toBe(true);
    expect(isThreadOnScreen(GRAND, "/chat", null)).toBe(false);
    expect(isThreadOnScreen(null, "/chat", null)).toBe(true);
    expect(isThreadOnScreen(null, "/chat", "global")).toBe(true);
    expect(isThreadOnScreen(null, "/chat", GRAND)).toBe(false);
  });

  it("counts the listing's own detail page, which carries the same thread", () => {
    expect(isThreadOnScreen(GRAND, `/listings/${GRAND}`, null)).toBe(true);
    expect(isThreadOnScreen(GRAND, "/listings", null)).toBe(false);
    expect(isThreadOnScreen(GRAND, `/listings/${GRAND}/edit`, null)).toBe(false);
  });

  it("never counts the group thread as open outside /chat", () => {
    expect(isThreadOnScreen(null, "/", null)).toBe(false);
    expect(isThreadOnScreen(null, `/listings/${GRAND}`, null)).toBe(false);
  });
});
