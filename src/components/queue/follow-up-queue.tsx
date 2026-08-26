"use client";

/**
 * Home is the follow-up queue, not a listing gallery (SPEC). Five sections,
 * always all five, each with its count — an empty Overdue section is the point
 * of the screen, not something to hide.
 *
 * Each bucket owns one colour (coral late / yellow now / blue quiet / mint
 * new), used for the header chip and for the border of every card under it.
 * Vanished? shares the quiet blue with Gone quiet: neither is on fire, both
 * want a person eventually. It sits above New, which is last, right above the
 * activity feed, because neither is a deadline — and for the same reason
 * neither is in the nav badge.
 */

import { Skeleton } from "@/components/ui/skeleton";
import { QueueRow } from "@/components/queue/queue-row";
import { VanishedRow } from "@/components/queue/vanished-row";
import { useQueue } from "@/components/queue/use-queue";
import type { QueueBucket } from "@/lib/queue";
import type { ListingRow } from "@/lib/queries";

const SECTIONS: ReadonlyArray<{
  bucket: QueueBucket;
  title: string;
  /** CSS colour token; also the border of the cards in this bucket. */
  tone: string;
}> = [
  {
    bucket: "overdue",
    title: "Overdue",
    tone: "var(--urgent)",
  },
  {
    bucket: "today",
    title: "Today",
    tone: "var(--due)",
  },
  {
    bucket: "cold",
    title: "Gone quiet",
    tone: "var(--quiet)",
  },
  {
    bucket: "vanished",
    title: "Vanished?",
    tone: "var(--quiet)",
  },
  {
    // Its own mint, not `--yes` — that one is a person's colour as well as a
    // vote's, and a bucket must never look like a housemate.
    bucket: "fresh",
    title: "New",
    tone: "var(--fresh)",
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
            <div className="flex items-center">
              <h2
                className="rounded-full px-2.5 py-1 text-xs font-black tracking-wide text-ink uppercase"
                style={{ backgroundColor: section.tone }}
              >
                {section.title} · {isPending ? "—" : rows.length}
              </h2>
            </div>

            {isPending ? (
              <Skeleton className="h-24 w-full rounded-[20px]" />
            ) : (
              rows.length > 0 && (
                <div className="grid gap-3">
                  {rows.map((row) =>
                    section.bucket === "vanished" ? (
                      <VanishedRow key={row.id} row={row} tone={section.tone} now={now} />
                    ) : (
                      <QueueRow
                        key={row.id}
                        row={row}
                        bucket={section.bucket}
                        tone={section.tone}
                        today={today}
                        now={now}
                      />
                    ),
                  )}
                </div>
              )
            )}
          </section>
        );
      })}
    </div>
  );
}
