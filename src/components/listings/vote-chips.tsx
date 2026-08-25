"use client";

/**
 * The compact read-out of a listing's votes — `✓2 ?1` — for the table column
 * and the mobile cards. Only nonzero counts are drawn, so a listing nobody has
 * looked at stays quiet; the tooltip spells out who voted what.
 *
 * `VOTE_TONE` is the one place the yes/maybe/no colours are defined: the pill
 * here, the row pills in `votes-card.tsx` and that card's active toggle button
 * all read from it, so green never means two different things.
 */

import { usePerson } from "@/lib/person";
import { VOTE_LABELS, VOTE_MARKS, VOTE_VALUES, voteCounts, voteTooltip } from "@/lib/votes";
import { cn } from "@/lib/utils";
import type { VoteRow } from "@/lib/queries";
import type { VoteValue } from "@/lib/types";

export const VOTE_TONE: Record<VoteValue, string> = {
  yes: "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  maybe: "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300",
  no: "border-rose-500/40 bg-rose-500/15 text-rose-700 dark:text-rose-300",
};

const PILL =
  "inline-flex h-5 items-center gap-0.5 rounded-full border px-1.5 text-xs font-medium tabular-nums";

/** One person's vote, spelled out. `—` when they have not voted. */
export function VotePill({
  vote,
  className,
}: {
  vote: VoteValue | null | undefined;
  className?: string;
}) {
  if (!vote) {
    return (
      <span
        className={cn(PILL, "border-border text-muted-foreground", className)}
        aria-label="No vote"
      >
        —
      </span>
    );
  }
  return (
    <span className={cn(PILL, VOTE_TONE[vote], className)}>{VOTE_LABELS[vote]}</span>
  );
}

export function VoteChips({
  votes,
  className,
}: {
  votes: readonly VoteRow[] | null | undefined;
  className?: string;
}) {
  const { people } = usePerson();
  const counts = voteCounts(votes);

  if (counts.total === 0) {
    return <span className={cn("text-muted-foreground", className)}>—</span>;
  }

  const title = voteTooltip(votes, (id) => people.find((p) => p.id === id)?.name);
  const label = VOTE_VALUES.filter((v) => counts[v] > 0)
    .map((v) => `${counts[v]} ${VOTE_LABELS[v].toLowerCase()}`)
    .join(", ");

  return (
    <span
      className={cn("inline-flex items-center gap-1", className)}
      title={title}
      aria-label={label}
    >
      {VOTE_VALUES.filter((v) => counts[v] > 0).map((v) => (
        <span key={v} className={cn(PILL, VOTE_TONE[v])} aria-hidden>
          {VOTE_MARKS[v]}
          {counts[v]}
        </span>
      ))}
    </span>
  );
}
