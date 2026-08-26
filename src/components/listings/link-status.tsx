"use client";

/**
 * "Link status" on the detail page: what the source page said last time
 * anything looked, when that was, and a button to look again now.
 *
 * Only rendered when the listing has a URL — there is nothing to check
 * otherwise, and a permanent "Not checked" against a hand-typed listing would
 * read as a failure rather than an absence.
 *
 * Three things it will not do: show a stale state as fact after a blocked
 * check (it says so instead), colour anything with a person's colour (this is
 * not about a person), or offer to change `status`. That decision lives on
 * Home, in front of the evidence.
 */

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePerson } from "@/lib/person";
import { useMutations } from "@/lib/mutations";
import { LINK_STATE_LABELS } from "@/lib/format";
import { isVanished } from "@/lib/queue";
import { isBlockedNote } from "@/lib/sync-types";
import { fmtNY, timeAgo } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { ListingRow } from "@/lib/queries";

/** A minute is finer than anything "3h ago" can show. Same tick as the queue. */
const TICK_MS = 60_000;

export function LinkStatus({ listing }: { listing: ListingRow }) {
  const { person } = usePerson();
  const { checkListingNow } = useMutations(person?.id);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const state = listing.listing_state ?? "unknown";
  const blocked = isBlockedNote(listing.state_note);
  const gone = isVanished({ listing_state: state });

  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span
        className={cn(
          "inline-flex h-5 shrink-0 items-center rounded-full border px-2 text-[11px] font-black",
          gone
            ? "border-quiet/40 bg-quiet/10 text-quiet"
            : state === "active"
              ? "border-transparent bg-yes text-ink"
              : "border-transparent bg-inset text-muted-foreground",
        )}
        title={listing.state_note ?? undefined}
      >
        {LINK_STATE_LABELS[state]}
      </span>

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

      {/* A blocked check knows nothing, so the chip beside it is history, not
          news. Say which, rather than letting the two read as one fact. */}
      {blocked && (
        <span className="text-xs text-faint" title={listing.state_note ?? undefined}>
          last check blocked — site won&apos;t let us look
        </span>
      )}

      <Button
        size="sm"
        variant="ghost"
        className="ml-auto"
        disabled={checkListingNow.isPending}
        onClick={() => checkListingNow.mutate(listing.id)}
      >
        <RefreshCw className={cn(checkListingNow.isPending && "animate-spin")} />
        {checkListingNow.isPending ? "Checking…" : "Check now"}
      </Button>
    </span>
  );
}
