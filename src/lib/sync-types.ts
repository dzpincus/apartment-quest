/**
 * The wire shape of `POST /api/sync`, plus the one convention both sides of it
 * share: what a `state_note` written by a blocked check looks like.
 *
 * In its own file, with no `server-only` import, because the client needs all
 * of it — `mutations.ts` types the response and the detail page has to
 * recognise a blocked note — while the classifier that writes those notes is
 * server-side. One string prefix, defined once.
 */

import type { ListingState, Uuid } from "@/lib/types";

/** One listing whose state moved during a run. `from` is what we thought before. */
export type SyncChange = {
  id: Uuid;
  label: string;
  from: ListingState;
  to: ListingState;
};

export type SyncResponse = {
  /** False when the hour gate or a missing key stopped the run before any work. */
  ran: boolean;
  /** True when this was one of the two pg_cron jobs firing at the wrong NY hour. */
  skipped_hour_gate: boolean;
  checked: number;
  changed: SyncChange[];
  /** Checks where the site never let us see the page. State left alone. */
  blocked: number;
  errors: number;
  /** Set for a `?listing=` run: what that one listing looks like now. */
  checkedListing?: { id: Uuid; state: ListingState; note: string | null; blocked: boolean };
  /** No `SUPABASE_SERVICE_ROLE_KEY` / `ANTHROPIC_API_KEY` on this deployment. */
  disabled?: true;
  error?: string;
};

/** The empty run, so every early return has the same shape. */
export const EMPTY_SYNC: SyncResponse = {
  ran: false,
  skipped_hour_gate: false,
  checked: 0,
  changed: [],
  blocked: 0,
  errors: 0,
};

/**
 * A check that never saw the page writes its note with this prefix. Two things
 * read it back: `/api/sync`, which then skips the *paid* Firecrawl rung for
 * three days rather than paying to be refused again, and the detail page,
 * which says "last check blocked" instead of showing a stale state as fact.
 */
export const BLOCKED_PREFIX = "blocked";

/** Longest note we store: `state_note` is rendered inside a table row. */
export const NOTE_CAP = 140;

export function blockedNote(reason: string): string {
  return `${BLOCKED_PREFIX} — ${reason}`.slice(0, NOTE_CAP);
}

export function isBlockedNote(note: string | null | undefined): boolean {
  return (
    typeof note === "string" &&
    note.trimStart().toLowerCase().startsWith(BLOCKED_PREFIX)
  );
}
