"use client";

/**
 * Yes / maybe / no from all four people, on the listing detail page.
 *
 * Every person always gets a row — a missing vote is information, so the widget
 * shows "—" rather than hiding whoever has not weighed in. Only your own row is
 * interactive. That is UI enforcement only: one shared login means anyone could
 * write anyone's vote, and SPEC says that is fine ("no per-person security
 * boundary"), so this is a guard rail, not a permission.
 *
 * Writes are optimistic (`useMutations().castVote`), so the pill flips on click
 * and the table's chips update in the same tick.
 */

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InlineEdit } from "@/components/inline-edit";
import { PersonDot } from "@/components/person-dot";
import { VoteChips, VotePill, VOTE_TONE } from "@/components/listings/vote-chips";
import { usePerson } from "@/lib/person";
import { useMutations } from "@/lib/mutations";
import { useVotes, type ListingRow, type VoteRow } from "@/lib/queries";
import { findVote, VOTE_LABELS, VOTE_VALUES } from "@/lib/votes";
import { fmtNY } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { Person, VoteValue } from "@/lib/types";

export function VotesCard({ listing }: { listing: ListingRow }) {
  const { person, people } = usePerson();
  const { castVote, clearVote } = useMutations(person?.id);
  const { data } = useVotes(listing.id);
  // Same cache entry as the listing itself, so this is never a second request;
  // the embedded array is the fallback for the first render.
  const votes = data ?? listing.votes ?? [];

  // Stable order regardless of when a row was seeded or renamed.
  const roster = [...people].sort((a, b) => a.key.localeCompare(b.key));

  const target = { id: listing.id, address: listing.address, unit: listing.unit };

  // `prev` lets the mutation word the summary ("voted yes" vs "changed vote to
  // maybe" vs "commented") and drop a blur that changed nothing.
  const cast = (prev: VoteRow | null, vote: VoteValue | null, comment: string | null) =>
    castVote.mutate({ listing: target, vote, comment, prev });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Votes</CardTitle>
          <VoteChips votes={votes} />
        </div>
      </CardHeader>
      <CardContent className="grid gap-3">
        {roster.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No people found. Run supabase/seed.sql.
          </p>
        )}
        {roster.map((who) => {
          const vote = findVote(votes, who.id);
          return (
            <VoteRowView
              key={who.id}
              who={who}
              vote={vote}
              isMe={who.id === person?.id}
              onCast={(next, comment) => cast(vote, next, comment)}
              onClear={() => clearVote.mutate(target)}
            />
          );
        })}
      </CardContent>
    </Card>
  );
}

function VoteRowView({
  who,
  vote,
  isMe,
  onCast,
  onClear,
}: {
  who: Person;
  vote: VoteRow | null;
  isMe: boolean;
  onCast: (vote: VoteValue | null, comment: string | null) => void;
  onClear: () => void;
}) {
  return (
    <div className="grid gap-1.5 border-b pb-3 last:border-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <PersonDot person={who} withName className="min-w-24 text-sm font-medium" />
        {isMe ? (
          <div className="flex items-center gap-1">
            {VOTE_VALUES.map((value) => {
              const active = vote?.vote === value;
              return (
                <Button
                  key={value}
                  size="xs"
                  variant="outline"
                  aria-pressed={active}
                  className={cn(active && VOTE_TONE[value])}
                  onClick={() => {
                    if (!active) onCast(value, vote?.comment ?? null);
                  }}
                >
                  {VOTE_LABELS[value]}
                </Button>
              );
            })}
            {vote && (
              <Button
                size="xs"
                variant="ghost"
                className="text-muted-foreground"
                onClick={onClear}
              >
                Clear
              </Button>
            )}
          </div>
        ) : (
          <VotePill vote={vote?.vote} />
        )}
        {vote?.updated_at && (
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            {fmtNY(vote.updated_at, "MMM d")}
          </span>
        )}
      </div>

      {isMe ? (
        <InlineEdit
          label="comment"
          value={vote?.comment ?? ""}
          placeholder="Add a comment…"
          className="text-sm text-muted-foreground"
          inputClassName="h-7"
          onSave={(raw) => onCast(vote?.vote ?? null, raw || null)}
        />
      ) : (
        vote?.comment && (
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">
            {vote.comment}
          </p>
        )
      )}
    </div>
  );
}
