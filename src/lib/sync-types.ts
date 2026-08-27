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
  /** Listings the run ran out of wall clock for. Next run picks them up first. */
  skipped_deadline: number;
  /** Set for a `?listing=` run: what that one listing looks like now. */
  checkedListing?: { id: Uuid; state: ListingState; note: string | null; blocked: boolean };
  /** No `SUPABASE_SERVICE_ROLE_KEY` / `ANTHROPIC_API_KEY` on this deployment. */
  disabled?: true;
  error?: string;
};

/**
 * The empty run, so every early return has the same shape.
 *
 * A factory rather than a shared constant: the old `EMPTY_SYNC` was spread
 * into six responses, and every one of them handed the *same* `changed` array
 * to the caller. Nothing mutates it today, which is exactly the kind of thing
 * that stays true until it does not.
 */
export function emptySync(): SyncResponse {
  return {
    ran: false,
    skipped_hour_gate: false,
    checked: 0,
    changed: [],
    blocked: 0,
    errors: 0,
    skipped_deadline: 0,
  };
}

/** What one check came back with. `/api/sync` builds these; `decide` below reads them. */
export type SyncOutcome =
  /** We saw the page and have an opinion about it. */
  | { kind: "state"; state: ListingState; note: string }
  /** We never saw the page. State is left alone; only the timestamp moves. */
  | { kind: "blocked"; note: string }
  /** Something went wrong on our side. */
  | { kind: "error"; message: string }
  /** The run hit its wall-clock budget before reaching this one. */
  | { kind: "skipped" };

/**
 * Did this check learn anything that may overwrite `listing_state`?
 *
 * Three ways to learn nothing, and only one of them used to be handled. A
 * block never saw the page. An error never got that far. And — the subtle one
 * — a page we *did* fetch and could not classify comes back `unknown`, which
 * is an absence of evidence and must not be written over a hard-won
 * `off_market`: a listing site that quietly changes its "no longer available"
 * wording would otherwise walk every vanished listing back to `unknown`
 * overnight and empty the Vanished section.
 *
 * `unknown` over `unknown` is not a loss of information, so a first sighting
 * still writes and still stamps the state.
 */
export function learnedNothing(outcome: SyncOutcome, before: ListingState): boolean {
  if (outcome.kind === "error" || outcome.kind === "skipped") return true;
  return (
    outcome.kind === "blocked" ||
    (outcome.state === "unknown" && before !== "unknown")
  );
}

/** A failed check's note. Same 140-char cap as a blocked one, different word. */
export function errorNote(reason: string): string {
  return `error — ${reason}`.slice(0, NOTE_CAP);
}

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
  return startsWith(note, BLOCKED_PREFIX);
}

/**
 * The two notes a *person* writes, and the predicate that reads the first one
 * back. "Still live" is a correction to a robot, and the robot has to respect
 * it: `/api/sync` will not put a manually confirmed listing back in the
 * Vanished section on the strength of a regex match alone (see `classify.ts` →
 * `needsModelConfirmation`). The model may still overrule a human — it read
 * the page, and apartments do go.
 */
export const MANUAL_LIVE_NOTE = "manually confirmed";
export const MANUAL_GONE_NOTE = "manually reported";

export function isManuallyConfirmedNote(note: string | null | undefined): boolean {
  return startsWith(note, MANUAL_LIVE_NOTE);
}

/**
 * A "gone" that only the regex tier believed and nothing could confirm. The
 * state written beside it is `unknown` — never `off_market` — so an unlucky
 * phrase in a price history cannot move a listing on its own.
 */
export const UNCONFIRMED_PREFIX = "unconfirmed:";

export function isUnconfirmedNote(note: string | null | undefined): boolean {
  return startsWith(note, UNCONFIRMED_PREFIX);
}

function startsWith(note: string | null | undefined, prefix: string): boolean {
  return (
    typeof note === "string" &&
    note.trimStart().toLowerCase().startsWith(prefix.toLowerCase())
  );
}
