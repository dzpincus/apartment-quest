"use client";

/**
 * "Link status" on the detail page: what the source page said last time
 * anything looked, when that was, the evidence it said it on, and the actions
 * a person can take about it.
 *
 * Only rendered when the listing has a URL — there is nothing to check
 * otherwise, and a permanent "Not checked" against a hand-typed listing would
 * read as a failure rather than an absence.
 *
 * It used to offer one button, "Check now", and no way at all to disagree with
 * the answer: the correction lived on Home's Vanished? section and nowhere
 * else, so a person looking straight at "Off market" on the detail page had
 * seen the claim and could do nothing about it. `LinkActions` is that missing
 * half, shared with the table and the cards.
 *
 * Two things it still will not do: show a stale state as fact after a blocked
 * check (it says so instead), or colour anything with a person's colour — this
 * is not about a person.
 */

import { useEffect, useState } from "react";
import { LinkActions } from "@/components/listings/link-actions";
import { LINK_STATE_LABELS } from "@/lib/format";
import { isVanished } from "@/lib/queue";
import { isBlockedNote, isUnconfirmedNote } from "@/lib/sync-types";
import { fmtNY, timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { ListingRow } from "@/lib/queries";
import type { ListingState } from "@/lib/types";

/** A minute is finer than anything "3h ago" can show. Same tick as the queue. */
const TICK_MS = 60_000;

export function LinkStatus({ listing }: { listing: ListingRow }) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const state = listing.listing_state ?? "unknown";
  const blocked = isBlockedNote(listing.state_note);
  const unconfirmed = isUnconfirmedNote(listing.state_note);

  return (
    <span className="flex flex-col gap-1">
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <LinkStateChip state={state} note={listing.state_note} />

        <span
          className="text-xs text-muted-foreground"
          title={
            listing.state_checked_at ? fmtNY(listing.state_checked_at) : undefined
          }
        >
          {listing.state_checked_at
            ? `checked ${timeAgo(listing.state_checked_at, now)}`
            : "never checked"}
        </span>

        <LinkActions listing={listing} className="ml-auto justify-end" />
      </span>

      {/* The evidence, in the page's own words. It was only ever a `title`
          before, which is no evidence at all on a phone. */}
      {listing.state_note?.trim() && !blocked && (
        <span className="min-w-0 truncate text-xs text-faint" title={listing.state_note}>
          {listing.state_note}
        </span>
      )}

      {/* A blocked check knows nothing, so the chip beside it is history, not
          news. Say which, rather than letting the two read as one fact. */}
      {blocked && (
        <span className="text-xs text-faint" title={listing.state_note ?? undefined}>
          last check blocked — site won&apos;t let us look
        </span>
      )}

      {/* A phrase we found and could not stand behind. The state stayed put;
          this is why the note looks like a verdict and the chip does not. */}
      {unconfirmed && (
        <span className="text-xs text-faint">
          a phrase on the page said gone — nothing could confirm it
        </span>
      )}
    </span>
  );
}

/** The state chip, shared with the badge popover so the two cannot disagree. */
export function LinkStateChip({
  state,
  note,
  className,
}: {
  state: ListingState;
  note?: string | null;
  className?: string;
}) {
  const gone = isVanished({ listing_state: state });
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-full border px-2 text-[11px] font-black",
        gone
          ? "border-quiet/40 bg-quiet/10 text-quiet"
          : state === "active"
            ? "border-transparent bg-yes text-ink"
            : "border-transparent bg-inset text-muted-foreground",
        className,
      )}
      title={note ?? undefined}
    >
      {LINK_STATE_LABELS[state]}
    </span>
  );
}
