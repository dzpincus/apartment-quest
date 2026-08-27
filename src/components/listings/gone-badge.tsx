"use client";

/**
 * "gone?" — the ghost badge a row wears when the source page stopped offering
 * the apartment (`listing_state`, 0006).
 *
 * A question mark, and quiet blue rather than the coral the overdue bucket
 * uses, because this is a robot's opinion about somebody else's website.
 *
 * Given a `listing`, the badge is also the way to *answer* it: tapping opens a
 * popover with the evidence, when we last looked, and the same three actions
 * the detail page offers (`LinkActions`). That used to live only in Home's
 * Vanished? section, which meant the badge stated a claim in four places and
 * took a reply in one. Without a `listing` it stays what it was — a `title`
 * and nothing else — which is what the map's mini card and the queue rows
 * want, since both already carry the buttons themselves.
 */

import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { LinkActions } from "@/components/listings/link-actions";
import { LINK_STATE_LABELS } from "@/lib/format";
import { isVanished } from "@/lib/queue";
import { isBlockedNote } from "@/lib/sync-types";
import { timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { ListingRow } from "@/lib/queries";
import type { ListingState } from "@/lib/types";

const BADGE_CLASS =
  "inline-flex h-5 shrink-0 items-center rounded-full border border-quiet/40 bg-quiet/10 px-2 text-[11px] font-black text-quiet";

export function GoneBadge({
  state,
  note,
  listing,
  className,
}: {
  state: ListingState | null | undefined;
  note?: string | null;
  /** Pass one to make the badge answerable. Omit it for a read-only badge. */
  listing?: Pick<
    ListingRow,
    "id" | "address" | "unit" | "status" | "listing_state" | "state_note" | "state_checked_at"
  >;
  className?: string;
}) {
  if (!isVanished({ listing_state: state ?? null })) return null;
  const label = LINK_STATE_LABELS[state ?? "unknown"];
  const title = note?.trim() ? `${label} — ${note}` : label;

  if (!listing) {
    return (
      <span title={title} className={cn(BADGE_CLASS, className)}>
        gone?
      </span>
    );
  }

  return (
    <Popover>
      <PopoverTrigger
        aria-label={`${label} — what should we do about it?`}
        className={cn(
          BADGE_CLASS,
          "cursor-pointer hover:bg-quiet/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          className,
        )}
      >
        gone?
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72">
        <PopoverHeader>
          <PopoverTitle>{label}</PopoverTitle>
          <PopoverDescription>
            {isBlockedNote(note)
              ? "The last check was blocked — this is the state from before it."
              : note?.trim() || "the listing page stopped offering it"}
          </PopoverDescription>
        </PopoverHeader>
        <p className="text-xs text-faint">
          {listing.state_checked_at
            ? `checked ${timeAgo(listing.state_checked_at, new Date())}`
            : "never checked"}
        </p>
        <LinkActions listing={listing} />
      </PopoverContent>
    </Popover>
  );
}
