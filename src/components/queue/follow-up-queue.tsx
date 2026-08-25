"use client";

/**
 * Home is the follow-up queue, not a listing gallery (SPEC). Three buckets,
 * always all three, each with its count — an empty Overdue section is the point
 * of the screen, not something to hide.
 */

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { QueueRow } from "@/components/queue/queue-row";
import { useQueue } from "@/components/queue/use-queue";
import type { QueueBucket } from "@/lib/queue";
import type { ListingRow } from "@/lib/queries";
import { cn } from "@/lib/utils";

const SECTIONS: ReadonlyArray<{
  bucket: QueueBucket;
  title: string;
  empty: string;
  dot: string;
  rail: string;
  badge: string;
}> = [
  {
    bucket: "overdue",
    title: "Overdue",
    empty: "Nothing overdue 🎉",
    dot: "bg-red-500",
    rail: "border-l-red-500/60",
    badge: "bg-red-500/15 text-red-600 dark:text-red-400",
  },
  {
    bucket: "today",
    title: "Today",
    empty: "Nothing due today.",
    dot: "bg-amber-500",
    rail: "border-l-amber-500/60",
    badge: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  },
  {
    bucket: "cold",
    title: "Cold",
    empty: "Nothing has gone quiet.",
    dot: "bg-sky-500",
    rail: "border-l-sky-500/60",
    badge: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
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
          <section key={section.bucket} className="grid gap-2">
            <div className="flex items-center gap-2">
              <span className={cn("size-2.5 rounded-full", section.dot)} aria-hidden />
              <h2 className="font-medium">{section.title}</h2>
              <Badge className={cn("tabular-nums", section.badge)}>
                {isPending ? "—" : rows.length}
              </Badge>
              {section.bucket === "cold" && (
                <span className="text-xs text-muted-foreground">
                  contacted, quiet 24h+, no next step
                </span>
              )}
            </div>

            <div className={cn("grid gap-2 border-l-2 pl-3", section.rail)}>
              {isPending ? (
                <Skeleton className="h-16 w-full" />
              ) : rows.length === 0 ? (
                <p className="py-1 text-sm text-muted-foreground">{section.empty}</p>
              ) : (
                rows.map((row) => (
                  <QueueRow
                    key={row.id}
                    row={row}
                    bucket={section.bucket}
                    today={today}
                    now={now}
                  />
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
