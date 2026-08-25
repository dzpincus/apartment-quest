/**
 * Pure vote helpers: counts, the table's sort score, the "my vote" filter and
 * the two cache patches the optimistic mutation needs. No React, no Supabase —
 * everything here is unit-testable (`votes.test.ts`).
 *
 * Votes ride along on the listing row (`LISTING_SELECT` embeds them), so every
 * helper takes the row's `votes` array rather than fetching anything.
 */

import type { VoteRow } from "@/lib/queries";
import type { Uuid, VoteValue } from "@/lib/types";

/** Display order everywhere: best first. */
export const VOTE_VALUES = ["yes", "maybe", "no"] as const;

export const VOTE_LABELS: Record<VoteValue, string> = {
  yes: "Yes",
  maybe: "Maybe",
  no: "No",
};

/** The chip glyphs: `✓2 ?1 ✗0`. */
export const VOTE_MARKS: Record<VoteValue, string> = {
  yes: "✓",
  maybe: "?",
  no: "✗",
};

export type VoteCounts = Record<VoteValue, number> & { total: number };

/** Rows with a null `vote` (comment only) count towards nothing. */
export function voteCounts(votes: readonly VoteRow[] | null | undefined): VoteCounts {
  const counts: VoteCounts = { yes: 0, maybe: 0, no: 0, total: 0 };
  for (const row of votes ?? []) {
    if (row.vote && row.vote in VOTE_LABELS) {
      counts[row.vote] += 1;
      counts.total += 1;
    }
  }
  return counts;
}

export function findVote(
  votes: readonly VoteRow[] | null | undefined,
  personId: Uuid | null | undefined,
): VoteRow | null {
  if (!personId) return null;
  return (votes ?? []).find((v) => v.person_id === personId) ?? null;
}

export function myVote(
  votes: readonly VoteRow[] | null | undefined,
  personId: Uuid | null | undefined,
): VoteValue | null {
  return findVote(votes, personId)?.vote ?? null;
}

/**
 * One number the generic column sorter can order by: descending gives "most
 * yeses first, ties broken by fewest nos", which is what the Votes column
 * means. Four people, so `no` can never reach the 10 that separates two `yes`
 * counts.
 */
export function voteScore(votes: readonly VoteRow[] | null | undefined): number {
  const c = voteCounts(votes);
  return c.yes * 10 - c.no;
}

/** Toolbar filter: `all` is off, `none` means "I have not voted". */
export type MyVoteFilter = "all" | VoteValue | "none";

export function matchesMyVote(
  votes: readonly VoteRow[] | null | undefined,
  personId: Uuid | null | undefined,
  filter: MyVoteFilter,
): boolean {
  if (filter === "all") return true;
  // Without a person there is no "my vote" to match — never hide everything.
  if (!personId) return true;
  const mine = myVote(votes, personId);
  return filter === "none" ? mine === null : mine === filter;
}

/**
 * Replace this person's row in place (or append it), so an optimistic update
 * does not reshuffle the widget while the write is in flight.
 */
export function upsertVote(
  votes: readonly VoteRow[] | null | undefined,
  next: VoteRow,
): VoteRow[] {
  const rows = [...(votes ?? [])];
  const at = rows.findIndex((v) => v.person_id === next.person_id);
  if (at === -1) rows.push(next);
  else rows[at] = next;
  return rows;
}

export function withoutVote(
  votes: readonly VoteRow[] | null | undefined,
  personId: Uuid,
): VoteRow[] {
  return (votes ?? []).filter((v) => v.person_id !== personId);
}

/** "Dylan: Yes — too far from the L" lines for the chips' tooltip. */
export function voteTooltip(
  votes: readonly VoteRow[] | null | undefined,
  nameOf: (personId: Uuid) => string | undefined,
): string {
  const lines = (votes ?? [])
    .filter((v) => v.vote)
    .map((v) => {
      const comment = v.comment?.trim();
      const name = nameOf(v.person_id) ?? "Someone";
      return `${name}: ${VOTE_LABELS[v.vote as VoteValue]}${comment ? ` — ${comment}` : ""}`;
    });
  return lines.join("\n");
}
