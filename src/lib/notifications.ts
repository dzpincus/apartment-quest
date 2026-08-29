/**
 * Browser notifications for new messages.
 *
 * This is the **Web Notifications** API and not Web Push: something is shown
 * only while a tab of this app is open somewhere. There is no service worker,
 * no VAPID key and no subscription stored anywhere — four people who each keep
 * the app in a tab do not need a push service, and a push service needs a
 * server component, a key pair and an unsubscribe path that nobody would
 * maintain.
 *
 * Everything in here is pure except `notificationPermission()`, which reads one
 * global. The decision — *should this message become a notification* — is a
 * function of five booleans and is tested as one, because getting it wrong
 * means either silence or a buzz for a message you are looking at.
 */

import { GLOBAL_THREAD_KEY, threadHref } from "@/lib/threads";

/** How much of a message a notification shows. */
export const NOTIFICATION_BODY_MAX = 120;

/**
 * `"unsupported"` is a real answer and not an error: iPhone Safari has no
 * `window.Notification` at all unless the app has been added to the Home
 * Screen, so the button has something specific to say rather than failing on
 * click.
 */
export type NotifyPermission = "unsupported" | NotificationPermission;

/** What this browser will currently let us do. Safe on the server. */
export function notificationPermission(): NotifyPermission {
  if (typeof window === "undefined") return "unsupported";
  const api = (window as { Notification?: { permission?: NotificationPermission } })
    .Notification;
  if (!api || typeof api.permission !== "string") return "unsupported";
  return api.permission;
}

/** The columns a decision is made from — a `messages` row satisfies it. */
export type NotifiableMessage = {
  person_id?: string | null;
  listing_id?: string | null;
  body?: string | null;
};

/**
 * Whether a `messages` insert should become a notification.
 *
 * Four of the five are obvious. The fifth — `visible && currentThreadOpen` —
 * is the one that matters: notifying somebody about a message that is already
 * on their screen is how a person turns notifications off for good. A message
 * in *another* thread still notifies even with the tab in front of you, since
 * the only sign of it otherwise is a small badge in a corner.
 */
export function shouldNotify({
  message,
  myPersonId,
  enabled,
  permission,
  visible,
  currentThreadOpen,
}: {
  message: NotifiableMessage;
  myPersonId: string | null | undefined;
  enabled: boolean;
  permission: NotifyPermission;
  /** `document.visibilityState === "visible"`. */
  visible: boolean;
  /** This message's thread is the one on screen right now. */
  currentThreadOpen: boolean;
}): boolean {
  if (!enabled) return false;
  if (permission !== "granted") return false;
  // Your own message, echoed back over realtime. Never.
  if (!message.person_id || (myPersonId && message.person_id === myPersonId)) return false;
  if (visible && currentThreadOpen) return false;
  return true;
}

export type NotificationContent = {
  title: string;
  body: string;
  /**
   * One notification per thread: a burst of five messages replaces itself
   * rather than stacking five banners.
   */
  tag: string;
};

/** `thread:<listingId>` / `thread:global` — the collapse key. */
export function threadTag(listingId: string | null | undefined): string {
  return `thread:${listingId ?? GLOBAL_THREAD_KEY}`;
}

/**
 * What the banner says. The title carries who and where, because a
 * notification is read in one glance and "Reese" alone does not say whether
 * this is about the group chat or about 214 Grand St.
 *
 * The body is trimmed to `NOTIFICATION_BODY_MAX` with an ellipsis — every
 * platform truncates anyway, and doing it here means the cut lands on a
 * character rather than mid-emoji at whatever width the OS picked.
 */
export function notificationBody(
  message: NotifiableMessage,
  personName: string | null | undefined,
  listingLabel: string | null,
): NotificationContent {
  const who = personName?.trim() || "Someone";
  const where = listingLabel?.trim() || "Group chat";
  const body = (message.body ?? "").trim();
  return {
    title: `${who} · ${where}`,
    body:
      body.length > NOTIFICATION_BODY_MAX
        ? `${body.slice(0, NOTIFICATION_BODY_MAX - 1).trimEnd()}…`
        : body,
    tag: threadTag(message.listing_id),
  };
}

/** Where clicking the notification lands. */
export function hrefForMessage(listingId: string | null | undefined): string {
  return threadHref(listingId ?? null);
}

/**
 * Is the thread this message belongs to the one currently on screen?
 *
 * Two places count: `/chat` with a matching `?t=` (absent and `global` are the
 * same thread), and the listing's own detail page, which carries the same
 * thread at the bottom. Pure, and given the location rather than reading it,
 * so both cases have a test.
 */
export function isThreadOnScreen(
  listingId: string | null | undefined,
  pathname: string,
  threadParam: string | null | undefined,
): boolean {
  const target = listingId ?? null;
  if (pathname === "/chat") {
    const open = !threadParam || threadParam === GLOBAL_THREAD_KEY ? null : threadParam;
    return open === target;
  }
  if (target === null) return false;
  return pathname === `/listings/${target}`;
}
