"use client";

/**
 * The compact read-out of a listing's votes, for the table column and the
 * mobile cards: one circle per person, filled with **their** colour, with the
 * vote as a glyph inside — `Y` / `?` / `N`, and `–` for nobody-home. Four
 * circles in a fixed order means the same person is always in the same place,
 * so a row is scannable without reading anything.
 *
 * `VOTE_TONE` is the one place the yes/maybe/no colours are defined: the pills
 * here, the row pills in `votes-card.tsx` and that card's active toggle button
 * all read from it, so mint never means two different things.
 */

import { PersonDot } from "@/components/person-dot";
import { usePerson } from "@/lib/person";
import { humans } from "@/lib/people";
import { VOTE_LABELS, voteTooltip } from "@/lib/votes";
import { cn } from "@/lib/utils";
import type { VoteRow } from "@/lib/queries";
import type { VoteValue } from "@/lib/types";

export const VOTE_TONE: Record<VoteValue, string> = {
  yes: "bg-yes text-ink border-transparent",
  maybe: "bg-maybe text-ink border-transparent",
  no: "bg-no text-ink border-transparent",
};

/** The glyph that goes inside a person's circle. */
const VOTE_GLYPH: Record<VoteValue, string> = {
  yes: "Y",
  maybe: "?",
  no: "N",
};

const PILL =
  "inline-flex h-5 items-center gap-0.5 rounded-full border px-2 text-[11px] font-black tabular-nums";

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
        className={cn(PILL, "border-transparent bg-inset text-faint", className)}
        aria-label="No vote"
      >
        —
      </span>
    );
  }
  return (
    <span className={cn(PILL, VOTE_TONE[vote], "uppercase", className)}>
      {VOTE_LABELS[vote]}
    </span>
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
  // Same order as the votes card, so a person keeps their slot everywhere —
  // and the same roster, housemates only (Quest Bot never votes).
  const roster = humans(people).sort((a, b) => a.key.localeCompare(b.key));
  if (roster.length === 0) return null;

  const title = voteTooltip(votes, (id) => people.find((p) => p.id === id)?.name);
  const label = roster
    .map((who) => {
      const v = votes?.find((row) => row.person_id === who.id)?.vote;
      return `${who.name}: ${v ? VOTE_LABELS[v].toLowerCase() : "no vote"}`;
    })
    .join(", ");

  return (
    <span
      className={cn("inline-flex items-center gap-1", className)}
      title={title || undefined}
      aria-label={label}
    >
      {roster.map((who) => {
        const vote = votes?.find((row) => row.person_id === who.id)?.vote ?? null;
        return (
          <PersonDot
            key={who.id}
            person={who}
            size="lg"
            letter={vote ? VOTE_GLYPH[vote] : "–"}
            className={cn(!vote && "opacity-45")}
          />
        );
      })}
    </span>
  );
}
