/**
 * The `/chat` thread list: one row per conversation, the group thread pinned
 * to the top.
 *
 * Three sources meet here and none of them is the whole answer. The
 * `thread_summaries()` RPC (0013) knows which threads have been spoken in and
 * what the last thing said was, but it holds no addresses; `listings` knows the
 * addresses but not the messages; `unread_counts` knows what you have not read.
 * Joining them in Postgres would mean a fourth query shape and a view that
 * duplicates `LISTING_SELECT`; joining them here is a Map lookup over rows
 * every screen already holds.
 *
 * Pure and structurally typed on purpose — `queries.ts` is a `"use client"`
 * module that pulls in the Supabase client, and nothing in here needs it. Same
 * reasoning as `unread.ts`.
 */

import { listingLabel, money } from "@/lib/format";
import type { UnreadLike } from "@/lib/unread";

/** The `?t=` value that names the group thread. */
export const GLOBAL_THREAD_KEY = "global";

/** What the group thread is called, in one place. */
export const GLOBAL_THREAD_LABEL = "Group chat";

/** A row of `thread_summaries()` — `ThreadSummary` in `queries.ts` satisfies it. */
export type ThreadSummaryLike = {
  /** null = the group thread. */
  listing_id: string | null;
  message_count?: number | null;
  last_at?: string | null;
  last_body?: string | null;
  last_person_id?: string | null;
};

/** The listing columns a thread row draws. `ListingRow` satisfies it. */
export type ThreadListingLike = {
  id: string;
  address?: string | null;
  unit?: string | null;
  neighborhood?: string | null;
  rent?: number | null;
  merged_into?: string | null;
};

export type ThreadListItem = {
  /** `"global"` or the listing's id — the `?t=` value and the React key. */
  key: string;
  /** null for the group thread, which is what `<Thread>` wants. */
  listingId: string | null;
  label: string;
  /** Neighborhood · rent for a listing; null for the group thread. */
  sublabel: string | null;
  lastAt: string | null;
  lastBody: string | null;
  lastPersonId: string | null;
  messageCount: number;
  unreadCount: number;
};

/** Whole, non-negative — a badge and a count are both integers. */
function count(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

/** ms since the epoch, or -Infinity for anything unusable (sorts last). */
function at(value: string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

/** "Bushwick · $3,200", or whichever half exists, or null. */
function sublabelFor(listing: ThreadListingLike): string | null {
  const parts = [listing.neighborhood?.trim(), money(listing.rent)].filter(
    (part): part is string => Boolean(part && part.length > 0),
  );
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * The `?t=` search param as a listing id. Absent and `"global"` both mean the
 * group thread, so `/chat` and `/chat?t=global` are the same conversation —
 * the difference between them is only which pane a phone is showing.
 */
export function listingIdFromThreadParam(param: string | null | undefined): string | null {
  if (!param || param === GLOBAL_THREAD_KEY) return null;
  return param;
}

/** The address bar for a thread. */
export function threadHref(listingId: string | null): string {
  return `/chat?t=${listingId ?? GLOBAL_THREAD_KEY}`;
}

/**
 * The ordered thread list.
 *
 * - The group thread is **always present and always first**, with zeros when
 *   nobody has said anything: it is where a conversation that is not about one
 *   apartment goes, and a chat screen that opens with an empty list is a bug
 *   somebody will report as "chat is broken".
 * - A listing thread appears only when it has messages *and* the listing is
 *   still live. `merged_into` is guarded even though `merge_listings` repoints
 *   a duplicate's messages at the survivor: a row that is hidden everywhere
 *   else must not be reachable from here either, and the cheap check is worth
 *   more than the assumption.
 * - A summary naming a listing the caller does not have is dropped rather than
 *   drawn as "(unknown)". `useListings()` fetches live rows only, so this is
 *   the ordinary shape of a merged or deleted listing, not an error.
 * - Everything after the pin is newest-message-first; a thread whose timestamp
 *   is missing or unparseable sinks to the bottom rather than jumping to the
 *   top, and the key is the tie-break so two rows never swap between renders.
 */
export function buildThreadList(
  summaries: readonly ThreadSummaryLike[] | null | undefined,
  listings: readonly ThreadListingLike[] | null | undefined,
  unread: UnreadLike | null | undefined,
): ThreadListItem[] {
  const byId = new Map<string, ThreadListingLike>();
  for (const listing of listings ?? []) {
    if (listing.merged_into) continue;
    byId.set(listing.id, listing);
  }

  const byListingUnread = unread?.byListing ?? {};

  let global: ThreadListItem = {
    key: GLOBAL_THREAD_KEY,
    listingId: null,
    label: GLOBAL_THREAD_LABEL,
    sublabel: null,
    lastAt: null,
    lastBody: null,
    lastPersonId: null,
    messageCount: 0,
    unreadCount: count(unread?.global),
  };

  const rows: ThreadListItem[] = [];

  for (const summary of summaries ?? []) {
    if (summary.listing_id == null) {
      global = {
        ...global,
        lastAt: summary.last_at ?? null,
        lastBody: summary.last_body ?? null,
        lastPersonId: summary.last_person_id ?? null,
        messageCount: count(summary.message_count),
      };
      continue;
    }

    const listing = byId.get(summary.listing_id);
    if (!listing) continue;

    rows.push({
      key: listing.id,
      listingId: listing.id,
      label: listingLabel(listing.address, listing.unit),
      sublabel: sublabelFor(listing),
      lastAt: summary.last_at ?? null,
      lastBody: summary.last_body ?? null,
      lastPersonId: summary.last_person_id ?? null,
      messageCount: count(summary.message_count),
      unreadCount: count(byListingUnread[listing.id]),
    });
  }

  rows.sort((a, b) => at(b.lastAt) - at(a.lastAt) || a.key.localeCompare(b.key));

  return [global, ...rows];
}
