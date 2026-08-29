"use client";

/**
 * What sits above the messages on `/chat`.
 *
 * For the group thread: the title, the line of copy, and one dot per person.
 *
 * For a listing thread: **the queue card**. Not a summary of it, not a second
 * design of it — `QueueRow`, the same component Home draws, in the colour of
 * whatever bucket the listing is in. A conversation about an apartment is
 * almost always a conversation about the next thing somebody has to do about
 * it, and "Log contact" belongs where that conversation is happening. A
 * listing in no bucket at all (applied, toured, passed) still gets the card,
 * drawn in the resting border colour — `bucketTone(null)` — because the
 * address, the broker, the owner and the button are useful whether or not the
 * queue has an opinion.
 *
 * The back chevron is mobile-only and `replace`s: the row that opened this
 * pane pushed a history entry, so replacing it here means Back leaves `/chat`
 * rather than bouncing between the list and the thread.
 */

import Link from "next/link";
import { ArrowUpRight, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NotifyToggle } from "@/components/chat/notify-toggle";
import { QueueRow } from "@/components/queue/queue-row";
import { useQueue } from "@/components/queue/use-queue";
import { bucketOf, bucketTone } from "@/lib/queue";
import { GLOBAL_THREAD_LABEL } from "@/lib/threads";
import type { ListingRow } from "@/lib/queries";
import type { Person } from "@/lib/types";

export function ThreadHeader({
  listing,
  listingId,
  people,
}: {
  /** The open listing, once it has loaded. Null for the group thread. */
  listing: ListingRow | null;
  /** The open thread's listing id — set even while `listing` is loading. */
  listingId: string | null;
  people: Person[];
}) {
  const { buckets, today, now } = useQueue();

  return (
    <div className="flex shrink-0 flex-col gap-3 pb-2">
      <div className="flex min-w-0 items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Back to threads"
          className="shrink-0 md:hidden"
          render={<Link href="/chat" replace />}
        >
          <ChevronLeft />
        </Button>

        {listingId === null ? (
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[22px] leading-tight md:text-2xl">
              {GLOBAL_THREAD_LABEL}
            </h1>
            <p className="truncate text-sm text-muted-foreground">
              Everything that is not about one listing.
            </p>
          </div>
        ) : (
          <div className="min-w-0 flex-1">
            <Link
              href={`/listings/${listingId}`}
              className="inline-flex items-center gap-1 text-sm font-extrabold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Open listing
              <ArrowUpRight className="size-3.5" />
            </Link>
          </div>
        )}

        {listingId === null && (
          /* Overlapping dots, one per person, in their own colour. */
          <div className="flex shrink-0 items-center">
            {people.map((p) => (
              <span
                key={p.id}
                title={p.name}
                className="size-5.5 rounded-full border-2 border-background not-first:-ml-1.5"
                style={{ backgroundColor: p.color ?? "#888" }}
              />
            ))}
          </div>
        )}

        <NotifyToggle className="shrink-0" />
      </div>

      {listing && (
        <QueueRow
          row={listing}
          bucket={bucketOf(buckets, listing.id) ?? "fresh"}
          tone={bucketTone(bucketOf(buckets, listing.id))}
          today={today}
          now={now}
        />
      )}
    </div>
  );
}
