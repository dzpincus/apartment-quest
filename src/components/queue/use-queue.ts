"use client";

import { useMemo } from "react";
import { useQueueListings, type ListingRow } from "@/lib/queries";
import { bucketListings, type Buckets } from "@/lib/queue";
import { todayNY } from "@/lib/time";

/**
 * The follow-up buckets, derived from the shared listings cache. Both the home
 * screen and the nav badge call this; React Query dedupes the request, so the
 * badge is free.
 */
export function useQueue(): {
  buckets: Buckets<ListingRow>;
  today: string;
  now: Date;
  isPending: boolean;
  error: unknown;
} {
  const { data, isPending, error } = useQueueListings();

  return useMemo(() => {
    const now = new Date();
    const today = todayNY(now);
    return {
      buckets: bucketListings(data ?? [], { todayNY: today, now }),
      today,
      now,
      isPending,
      error,
    };
  }, [data, isPending, error]);
}
