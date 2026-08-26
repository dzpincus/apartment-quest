"use client";

/**
 * Home is the follow-up queue, not a listing gallery (SPEC). Three buckets,
 * always all three, each with its count — an empty Overdue section is the point
 * of the screen, not something to hide.
 *
 * Each bucket owns one colour (coral late / yellow now / blue quiet), used for
 * the header chip and for the border of every card under it.
 */

import { Skeleton } from "@/components/ui/skeleton";
import { QueueRow } from "@/components/queue/queue-row";
import { useQueue } from "@/components/queue/use-queue";
import type { QueueBucket } from "@/lib/queue";
import type { ListingRow } from "@/lib/queries";

const SECTIONS: ReadonlyArray<{
  bucket: QueueBucket;
  title: string;
  empty: string;
  /** CSS colour token; also the border of the cards in this bucket. */
  tone: string;
  note?: string;
}> = [
  {
    bucket: "overdue",
    title: "Overdue",
    empty: "Nothing overdue. Heroes.",
    tone: "var(--urgent)",
  },
  {
    bucket: "today",
    title: "Today",
    empty: "Nothing due today.",
    tone: "var(--due)",
  },
  {
    bucket: "cold",
    title: "Gone quiet",
    empty: "nobody's ghosting you",
    tone: "var(--quiet)",
    note: "contacted, quiet 24h+, no next step",
  },
];

export function FollowUpQueue() {
  const { buckets, today, now, isPending, error } = useQueue();

  if (error) {
    return (
      <p className="text-sm text-destructive">
        Could not load the queue: {String((error as Error).message)}
      </p>
    );
  }

  return (
    <div className="grid gap-5">
      {SECTIONS.map((section) => {
        const rows: ListingRow[] = buckets[section.bucket];
        return (
          <section key={section.bucket} className="grid gap-2.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2
                className="rounded-full px-2.5 py-1 text-xs font-black tracking-wide text-ink uppercase"
                style={{ backgroundColor: section.tone }}
              >
                {section.title} · {isPending ? "—" : rows.length}
              </h2>
              {section.note && (
                <span className="text-xs text-muted-foreground">{section.note}</span>
              )}
              {!isPending && rows.length === 0 && (
                <span className="ml-auto text-[13px] text-faint">{section.empty}</span>
              )}
            </div>

            {isPending ? (
              <Skeleton className="h-24 w-full rounded-[20px]" />
            ) : (
              rows.length > 0 && (
                <div className="grid gap-3">
                  {rows.map((row) => (
                    <QueueRow
                      key={row.id}
                      row={row}
                      bucket={section.bucket}
                      tone={section.tone}
                      today={today}
                      now={now}
                    />
                  ))}
                </div>
              )
            )}
          </section>
        );
      })}
    </div>
  );
}
