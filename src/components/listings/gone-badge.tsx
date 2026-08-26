/**
 * "gone?" — the ghost badge a row wears when the source page stopped offering
 * the apartment (`listing_state`, 0006).
 *
 * A question mark, and quiet blue rather than the coral the overdue bucket
 * uses, because this is a robot's opinion about somebody else's website. The
 * decision it invites — Mark lost, or Still live — lives on Home's Vanished?
 * section and on the detail page, never on a badge.
 *
 * `title` carries the evidence, so hovering a row in the table answers "gone
 * according to what?" without opening anything.
 */

import { LINK_STATE_LABELS } from "@/lib/format";
import { isVanished } from "@/lib/queue";
import { cn } from "@/lib/utils";
import type { ListingState } from "@/lib/types";

export function GoneBadge({
  state,
  note,
  className,
}: {
  state: ListingState | null | undefined;
  note?: string | null;
  className?: string;
}) {
  if (!isVanished({ listing_state: state ?? null })) return null;
  const label = LINK_STATE_LABELS[state ?? "unknown"];
  return (
    <span
      title={note?.trim() ? `${label} — ${note}` : label}
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-full border border-quiet/40 bg-quiet/10 px-2 text-[11px] font-black text-quiet",
        className,
      )}
    >
      gone?
    </span>
  );
}
