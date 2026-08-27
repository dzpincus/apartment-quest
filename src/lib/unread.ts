/**
 * Pure views over the flattened `unread_counts` RPC (`UnreadSummary` in
 * `queries.ts`).
 *
 * The nav badges and the home screen's unread strip ask the same two questions
 * — how many messages are waiting in the group chat, and which listings have
 * something new — and both used to answer them with an inline
 * `Object.values(...).filter(...)`. One of those inlines was passing the whole
 * summary object to a badge that wanted a number, which renders nothing at all.
 * A named helper with tests is the cheaper version of that bug.
 *
 * Structurally typed on purpose: `queries.ts` is a `"use client"` module that
 * pulls in the Supabase client, and nothing here needs it.
 */

export type UnreadLike = {
  /** The global thread. */
  global?: number | null;
  /** listing id -> unread count. Zeros are allowed and ignored. */
  byListing?: Record<string, number> | null;
};

export type UnreadView = {
  /** Unread in the group chat — the Chat tab's badge. */
  chatCount: number;
  /**
   * Listings with at least one unread message, in the order the RPC returned
   * them. The Listings tab badges the length; the home strip deep-links when
   * there is exactly one.
   */
  listingIds: string[];
};

/** Total, never negative, never fractional — a badge is a whole number. */
function count(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

/**
 * `{ chatCount, listingIds }` from an unread summary. Total: a missing or
 * half-loaded summary reads as "nothing unread" rather than throwing, because
 * `useUnread()` hands out zeros until the query lands.
 */
export function unreadSummary(unread: UnreadLike | null | undefined): UnreadView {
  const byListing = unread?.byListing ?? {};
  const listingIds: string[] = [];
  for (const [listingId, n] of Object.entries(byListing)) {
    if (count(n) > 0) listingIds.push(listingId);
  }
  return { chatCount: count(unread?.global), listingIds };
}
