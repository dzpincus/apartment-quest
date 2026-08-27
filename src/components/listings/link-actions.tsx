"use client";

/**
 * The three answers a person can give about a listing's **link state**, in one
 * place, so the detail page, the table row and the mobile card cannot drift
 * apart.
 *
 * There are two statuses in this app and only one of them used to be
 * answerable outside Home:
 *
 * - `status` — where *we* are (saved → contacted → applied). Ours. `StatusSelect`.
 * - `listing_state` — what the *site* says (0006). The sync's. This.
 *
 * "Still live" and "Report gone" write `listing_state` with a note that starts
 * with `manually confirmed` / `manually reported`, which is not decoration:
 * `/api/sync` reads the first one back and refuses to re-flag a manually
 * confirmed listing on a regex match alone (`classify.ts` →
 * `needsModelConfirmation`). Neither writes an activity row — correcting a
 * robot is not an impression.
 *
 * **Mark lost** is the one action here that touches `status`, and it is the
 * ordinary `setListingStatus` with the ordinary feed line, because "we lost
 * this one" is a decision a human made and the feed should say who.
 */

import { Ghost, RefreshCw, ThumbsUp, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePerson } from "@/lib/person";
import { useMutations } from "@/lib/mutations";
import { isVanished } from "@/lib/queue";
import { MANUAL_GONE_NOTE, MANUAL_LIVE_NOTE } from "@/lib/sync-types";
import { cn } from "@/lib/utils";
import type { ListingRow } from "@/lib/queries";

export function LinkActions({
  listing,
  className,
}: {
  listing: Pick<ListingRow, "id" | "address" | "unit" | "status" | "listing_state">;
  className?: string;
}) {
  const { person } = usePerson();
  const { checkListingNow, setListingState, setListingStatus } = useMutations(person?.id);

  const state = listing.listing_state ?? "unknown";
  const gone = isVanished({ listing_state: state });
  const pending =
    checkListingNow.isPending || setListingState.isPending || setListingStatus.isPending;

  return (
    <span className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => checkListingNow.mutate(listing.id)}
      >
        <RefreshCw className={cn(checkListingNow.isPending && "animate-spin")} />
        {checkListingNow.isPending ? "Checking…" : "Check now"}
      </Button>

      {gone ? (
        <>
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() =>
              setListingState.mutate({
                listing: { id: listing.id },
                state: "active",
                note: MANUAL_LIVE_NOTE,
              })
            }
          >
            <ThumbsUp />
            Still live
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() =>
              setListingStatus.mutate({
                listing: {
                  id: listing.id,
                  address: listing.address,
                  unit: listing.unit,
                  status: listing.status,
                },
                status: "lost",
              })
            }
          >
            <XCircle />
            Mark lost
          </Button>
        </>
      ) : (
        state === "active" && (
          // Deliberately quieter than the other two: reporting a live listing
          // gone is the rarer thing to be doing, and it is the one action here
          // that creates work rather than closing it.
          <Button
            size="sm"
            variant="ghost"
            className="text-faint"
            disabled={pending}
            onClick={() =>
              setListingState.mutate({
                listing: { id: listing.id },
                state: "off_market",
                note: MANUAL_GONE_NOTE,
              })
            }
          >
            <Ghost />
            Report gone
          </Button>
        )
      )}
    </span>
  );
}
