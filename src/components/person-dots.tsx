import { PersonDot } from "@/components/person-dot";
import { cn } from "@/lib/utils";
import type { Person } from "@/lib/types";

/**
 * Several people in the space one used to take: the follow-up owners (0014).
 *
 * One owner is the old thing exactly — `PersonDot withName`, the dot and the
 * name — because "Dylan" is more useful than a coloured circle when there is
 * room for it. Two or more overlap into a stack, the same trick the group
 * thread's header uses for the four of us, with the names in the `title` and
 * again for screen readers: four names on a queue card is a second line, and
 * the card already has three.
 *
 * Colour comes from `people.color` through `PersonDot` and an inline style, so
 * this is still not a component that knows anybody's hex.
 */
export function PersonDots({
  people,
  className,
  /** What to draw for nobody at all. `null` draws nothing. */
  empty = "—",
  /**
   * The colour the stacked discs are ringed in — it has to match whatever they
   * sit on, or the overlap reads as one blob. Card by default.
   */
  ringClassName = "border-card",
}: {
  people: ReadonlyArray<Pick<Person, "id" | "name" | "color">>;
  className?: string;
  empty?: React.ReactNode;
  ringClassName?: string;
}) {
  if (people.length === 0) {
    return empty === null ? null : (
      <span className={cn("text-muted-foreground", className)}>{empty}</span>
    );
  }

  if (people.length === 1) {
    return <PersonDot person={people[0]} withName className={className} />;
  }

  const names = people.map((person) => person.name).join(", ");

  return (
    <span className={cn("inline-flex items-center", className)} title={names}>
      {people.map((person) => (
        <span
          key={person.id}
          className={cn("size-4 shrink-0 rounded-full border-2 not-first:-ml-1.5", ringClassName)}
          style={{ backgroundColor: person.color ?? "#888" }}
          aria-hidden
        />
      ))}
      <span className="sr-only">{names}</span>
    </span>
  );
}
