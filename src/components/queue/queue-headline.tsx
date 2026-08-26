"use client";

/**
 * The home screen's title block. Lives in a component rather than the page
 * because the subtitle counts what is actually due — `useQueue()` reads the
 * shared listings cache (same key as the queue below it and the nav badge), so
 * this costs no extra request.
 */

import { needsAttentionCount, queueSubtitle } from "@/lib/queue";
import { useQueue } from "@/components/queue/use-queue";

export function QueueHeadline() {
  const { buckets, isPending } = useQueue();
  const due = needsAttentionCount(buckets);

  return (
    <div className="grid gap-1">
      <h1 className="text-[26px] leading-tight md:text-3xl">Apartment Quest</h1>
      <p className="text-sm text-muted-foreground">
        {isPending ? "Counting what is on fire…" : queueSubtitle(due)}
      </p>
    </div>
  );
}
