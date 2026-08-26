/**
 * The four amenity columns (0009) in one glance: 🧺 In-unit · 🍽️ DW ·
 * ❄️ Window · 🌿 Shared.
 *
 * Read-only by design, exactly like `PetsMark`: the table and the cards are for
 * scanning, and the detail page is where an amenity gets set.
 *
 * `unknown` is dropped rather than printed. Four em dashes on every listing
 * nobody has asked about would be four times the noise and no information; a
 * row where all four are unanswered gets a single quiet "—", which is the same
 * thing an empty cell says.
 */

import {
  AC_LABELS,
  AC_MARKS,
  DISHWASHER_LABELS,
  DISHWASHER_MARKS,
  LAUNDRY_LABELS,
  LAUNDRY_MARKS,
  OUTDOOR_LABELS,
  OUTDOOR_MARKS,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  AcPolicy,
  DishwasherPolicy,
  LaundryPolicy,
  OutdoorSpacePolicy,
} from "@/lib/types";

export type AmenityFields = {
  laundry?: LaundryPolicy | null;
  dishwasher?: DishwasherPolicy | null;
  ac?: AcPolicy | null;
  outdoor_space?: OutdoorSpacePolicy | null;
};

type Mark = { key: string; mark: string; label: string };

/**
 * The marks worth printing, in the order people ask about them. Null is the
 * pre-0009 shape of the same "nobody asked yet" the `'unknown'` default means,
 * so both resolve the same way.
 */
export function amenityMarks(listing: AmenityFields): Mark[] {
  const laundry = listing.laundry ?? "unknown";
  const dishwasher = listing.dishwasher ?? "unknown";
  const ac = listing.ac ?? "unknown";
  const outdoor = listing.outdoor_space ?? "unknown";

  const out: Mark[] = [];
  if (laundry !== "unknown") {
    out.push({ key: "laundry", mark: LAUNDRY_MARKS[laundry], label: LAUNDRY_LABELS[laundry] });
  }
  if (dishwasher !== "unknown") {
    out.push({
      key: "dishwasher",
      mark: DISHWASHER_MARKS[dishwasher],
      label: DISHWASHER_LABELS[dishwasher],
    });
  }
  if (ac !== "unknown") {
    out.push({ key: "ac", mark: AC_MARKS[ac], label: AC_LABELS[ac] });
  }
  if (outdoor !== "unknown") {
    out.push({ key: "outdoor", mark: OUTDOOR_MARKS[outdoor], label: OUTDOOR_LABELS[outdoor] });
  }
  return out;
}

export function AmenityMarks({
  listing,
  variant = "marks",
  className,
}: {
  listing: AmenityFields;
  /** `chips` is the mobile card's shape — same content, its own pill each. */
  variant?: "marks" | "chips";
  className?: string;
}) {
  const marks = amenityMarks(listing);

  if (marks.length === 0) {
    return <span className={cn("text-muted-foreground", className)}>—</span>;
  }

  return (
    <span className={cn("flex flex-wrap items-center gap-1", className)}>
      {marks.map((m) => (
        <span
          key={m.key}
          title={m.label}
          className={cn(
            "whitespace-nowrap",
            variant === "chips" && "rounded-full bg-inset px-2 py-0.5 text-[11px] font-extrabold",
          )}
        >
          {m.mark}
        </span>
      ))}
    </span>
  );
}
