/**
 * The pet policy in one glance: 🐾 OK / 🐱 Cats / 🐶 Dogs / 🚫 No / —.
 *
 * Read-only by design — the table and the cards are for scanning, and the
 * detail page is where the policy gets set. `title` carries the long label the
 * mark abbreviates, plus the fine print if anyone wrote any down.
 */

import { PETS_LABELS, PETS_MARKS } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PetsPolicy } from "@/lib/types";

export function PetsMark({
  pets,
  notes,
  className,
}: {
  pets: PetsPolicy | null | undefined;
  notes?: string | null;
  className?: string;
}) {
  // Null is the pre-0005 shape of the same "nobody asked yet" the default means.
  const value = pets ?? "unknown";
  const label = PETS_LABELS[value];
  return (
    <span
      title={notes ? `${label} — ${notes}` : label}
      className={cn(
        "whitespace-nowrap",
        value === "unknown" && "text-muted-foreground",
        className,
      )}
    >
      {PETS_MARKS[value]}
    </span>
  );
}
