import { cn } from "@/lib/utils";
import type { Person } from "@/lib/types";

/**
 * The one place a person's colour reaches the screen.
 *
 * Every surface that identifies someone — queue rows, votes, chat, the activity
 * feed, listing borders — goes through this, always via `person.color` as an
 * inline style. No component hardcodes a person's hex: the colours live in the
 * `people` table and a fifth housemate must not require a code change.
 *
 * Three shapes: a bare dot, a dot with the name next to it (`withName`), and a
 * filled circle with a glyph inside (`letter`) for the vote chips.
 */

const SIZES = {
  sm: "size-2.5",
  md: "size-3",
  lg: "size-5.5",
} as const;

const LETTER_SIZES = {
  sm: "size-4 text-[9px]",
  md: "size-5 text-[10px]",
  lg: "size-5.5 text-[11px]",
} as const;

export function PersonDot({
  person,
  withName = false,
  size = "sm",
  letter,
  className,
  title,
  /** Colour the name in the person's colour, not just the dot. */
  colorName = false,
}: {
  person: Pick<Person, "name" | "color"> | null | undefined;
  withName?: boolean;
  size?: keyof typeof SIZES;
  letter?: string;
  className?: string;
  title?: string;
  colorName?: boolean;
}) {
  if (!person) return <span className="text-muted-foreground">—</span>;
  const color = person.color ?? "#888";

  // The glyph-in-a-circle variant: a filled disc, dark text, ringed in the card
  // colour so adjacent circles read as separate.
  if (letter !== undefined) {
    return (
      <span
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-full border-2 border-card font-black text-ink",
          LETTER_SIZES[size],
          className,
        )}
        style={{ backgroundColor: color }}
        title={title}
        aria-hidden
      >
        {letter}
      </span>
    );
  }

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)} title={title}>
      <span
        className={cn("shrink-0 rounded-full", SIZES[size])}
        style={{ backgroundColor: color }}
        aria-hidden
      />
      <span
        className={withName ? undefined : "sr-only"}
        style={colorName ? { color } : undefined}
      >
        {person.name}
      </span>
    </span>
  );
}
