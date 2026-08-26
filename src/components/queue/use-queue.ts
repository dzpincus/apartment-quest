"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueueListings, type ListingRow } from "@/lib/queries";
import { bucketListings, type Buckets } from "@/lib/queue";
import { todayNY } from "@/lib/time";

/** How often the buckets re-evaluate against the wall clock. */
const TICK_MS = 60_000;

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

  // The clock is state, not a `new Date()` inside the memo: the buckets are
  // boundaries in time (midnight NY, the 24h cold line) and a tab left open
  // used to keep yesterday's answer until something else forced a re-render.
  // A minute is finer than any boundary the queue draws.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  return useMemo(() => {
    const today = todayNY(now);
    return {
      buckets: bucketListings(data ?? [], { todayNY: today, now }),
      today,
      now,
      isPending,
      error,
    };
  }, [data, now, isPending, error]);
}
