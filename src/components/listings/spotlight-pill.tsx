"use client";

/**
 * The tiny "somebody is shouting about this row" mark (0012), for the listings
 * table and the mobile cards.
 *
 * A megaphone and the initials of whoever spotlighted the listing, and nothing
 * else: the note itself is on Home and on the detail page, and a row in a table
 * has no room for a sentence. It rides in the `title`, so the answer to "why?"
 * is a hover away on desktop without costing the column a pixel.
 *
 * Not a button. Everything a spotlight can *do* — set, edit, remove — lives in
 * the dialog on the detail page, which is one tap away through the row itself,
 * and a popover trigger here would be the third interactive thing in an Address
 * cell that already has an inline edit and a link.
 *
 * Renders nothing when nobody has spotlighted the row, so callers drop it in
 * unconditionally. Quest Bot is filtered by `usePerson().people`, which is
 * humans-only.
 */

import { Megaphone } from "lucide-react";
import { PersonDot } from "@/components/person-dot";
import { usePerson } from "@/lib/person";
import type { SpotlightRow } from "@/lib/queries";
import { cn } from "@/lib/utils";

/** Four people, so this cap is a guard rail rather than a real limit. */
const MAX_FACES = 4;

export function SpotlightPill({
  spotlights,
  className,
}: {
  spotlights: SpotlightRow[] | null | undefined;
  className?: string;
}) {
  const { people } = usePerson();

  const shown = (spotlights ?? [])
    .map((s) => ({ spotlight: s, person: people.find((p) => p.id === s.person_id) }))
    .filter((entry): entry is { spotlight: SpotlightRow; person: (typeof people)[number] } =>
      Boolean(entry.person),
    )
    .slice(0, MAX_FACES);

  if (shown.length === 0) return null;

  const title = shown
    .map(({ person, spotlight }) => {
      const note = spotlight.note?.trim();
      return note ? `${person.name}: ${note}` : person.name;
    })
    .join(" · ");

  return (
    <span
      title={title}
      aria-label={`Spotlighted — ${title}`}
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-1.5 text-primary",
        className,
      )}
    >
      <Megaphone className="size-3" aria-hidden />
      {/* Overlapped by a couple of pixels so four of them still read as one
          mark rather than as a row of separate chips. */}
      <span className="flex -space-x-1">
        {shown.map(({ person }) => (
          <PersonDot
            key={person.id}
            person={person}
            size="sm"
            letter={person.name.slice(0, 1).toUpperCase()}
          />
        ))}
      </span>
    </span>
  );
}
