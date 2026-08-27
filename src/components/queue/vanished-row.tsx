"use client";

/**
 * One card of the Vanished? section: a listing whose source page stopped
 * offering the apartment, and the two answers a person can give.
 *
 * **Mark lost** is the existing `setListingStatus('lost')` — the same write the
 * status dropdown does, with the same activity line, because "we lost this
 * one" is a decision a human makes and the feed should say who made it.
 * **Still live** writes `listing_state` back to `active` with the note
 * "manually confirmed" and nothing else: the robot was wrong, and a correction
 * to a robot is not an impression worth a feed entry.
 *
 * Nothing here happens automatically. The sync will never set a status.
 */

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePerson } from "@/lib/person";
import { useMutations } from "@/lib/mutations";
import { LINK_STATE_LABELS, listingLabel } from "@/lib/format";
import { MANUAL_LIVE_NOTE } from "@/lib/sync-types";
import { timeAgo } from "@/lib/time";
import type { ListingRow } from "@/lib/queries";

export function VanishedRow({
  row,
  tone,
  now,
}: {
  row: ListingRow;
  /** The bucket's colour, as a CSS value. */
  tone: string;
  now: Date;
}) {
  const { person } = usePerson();
  const { setListingStatus, setListingState } = useMutations(person?.id);

  const state = row.listing_state ?? "unknown";
  const pending = setListingStatus.isPending || setListingState.isPending;

  return (
    <div
      className="flex flex-col gap-3 rounded-[20px] border-2 bg-card p-4"
      style={{ borderColor: tone }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/listings/${row.id}`}
            className="block truncate text-[17px] font-black underline-offset-4 hover:underline"
          >
            {listingLabel(row.address, row.unit)}
          </Link>
          <p className="truncate text-xs text-muted-foreground">
            {row.broker?.name ?? "no broker"}
            {row.neighborhood ? ` · ${row.neighborhood}` : ""}
          </p>
        </div>
        <span
          className="shrink-0 text-xs font-extrabold whitespace-nowrap"
          style={{ color: tone }}
        >
          {LINK_STATE_LABELS[state]}
        </span>
      </div>

      {/* The evidence, in the page's own words, and when we last looked. */}
      <div className="grid gap-1 rounded-[14px] bg-inset px-3 py-2.5 text-sm">
        <span className="min-w-0 truncate" title={row.state_note ?? undefined}>
          {row.state_note?.trim() || "the listing page stopped offering it"}
        </span>
        <span className="text-xs text-muted-foreground">
          checked {timeAgo(row.state_checked_at, now)}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() =>
            setListingStatus.mutate({
              listing: {
                id: row.id,
                address: row.address,
                unit: row.unit,
                status: row.status,
              },
              status: "lost",
            })
          }
        >
          Mark lost
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() =>
            setListingState.mutate({
              listing: { id: row.id },
              state: "active",
              note: MANUAL_LIVE_NOTE,
            })
          }
        >
          Still live
        </Button>
        {row.url && /^https?:\/\//i.test(row.url) && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            render={<a href={row.url} target="_blank" rel="noreferrer" />}
          >
            <ExternalLink />
            Open
          </Button>
        )}
      </div>
    </div>
  );
}
