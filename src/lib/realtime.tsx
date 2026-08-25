"use client";

/**
 * One Supabase realtime channel for the whole app, mounted once in
 * `(app)/layout.tsx` inside the QueryClientProvider.
 *
 * It carries no data of its own: every `postgres_changes` event is turned into
 * a React Query invalidation, so the fetchers in `queries.ts` stay the single
 * way rows reach the UI. Payload rows are only used to work out *which* key to
 * invalidate — never written into the cache — which keeps embedded joins
 * (`person`, `broker`) honest, since realtime payloads are flat table rows.
 *
 * Auth: `createBrowserClient` builds a SupabaseClient that hands realtime-js an
 * `accessToken` callback, and realtime-js calls it on connect and before every
 * subscribe (`RealtimeClient._setAuthSafely`). The socket therefore carries the
 * logged-in user's JWT and RLS'd tables pass their per-subscriber check without
 * a manual `supabase.realtime.setAuth(...)`. That call is only needed for
 * private Broadcast/Presence channels, which this app does not use.
 */

import { useEffect } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { queryKeys } from "@/lib/queries";

/** Every table in the `supabase_realtime` publication (0003_rpc_triggers.sql). */
const TABLES = ["messages", "listings", "votes", "activity", "interactions"] as const;
type Table = (typeof TABLES)[number];

/**
 * A single insert can fan out into several events (a message plus its activity
 * row); collapsing a burst into one invalidation per key stops a chat storm
 * from turning into a refetch storm.
 */
const DEBOUNCE_MS = 150;

type Row = Record<string, unknown>;

/** DELETE payloads carry `old`; everything else carries `new`. */
function rowOf(payload: RealtimePostgresChangesPayload<Row>): Row {
  const next = payload.new as Row | undefined;
  if (next && Object.keys(next).length > 0) return next;
  return (payload.old as Row | undefined) ?? {};
}

function id(row: Row, column: string): string | null {
  const value = row[column];
  return typeof value === "string" ? value : null;
}

/** Which cache entries a change to `table` can possibly have invalidated. */
export function keysForChange(table: Table, row: Row): QueryKey[] {
  switch (table) {
    case "messages":
      // A default replica identity gives DELETE only the primary key; without
      // `listing_id` we cannot tell which thread moved, so refresh them all.
      return [
        "listing_id" in row ? queryKeys.thread(id(row, "listing_id")) : queryKeys.messages,
        queryKeys.unread,
      ];
    case "listings": {
      const listingId = id(row, "id");
      return listingId
        ? [queryKeys.listings, queryKeys.listing(listingId)]
        : [queryKeys.listings];
    }
    case "activity":
      return [queryKeys.activity];
    case "interactions": {
      const listingId = id(row, "listing_id");
      // `last_contacted_at` moves with an interaction, so the queue is stale too.
      return listingId
        ? [queryKeys.interactions(listingId), queryKeys.listings]
        : [queryKeys.listings];
    }
    case "votes": {
      const listingId = id(row, "listing_id");
      return listingId ? [queryKeys.votes(listingId), queryKeys.listings] : [queryKeys.listings];
    }
  }
}

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const supabase = createClient();
    const pending = new Map<string, QueryKey>();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      timer = null;
      const keys = [...pending.values()];
      pending.clear();
      for (const queryKey of keys) void queryClient.invalidateQueries({ queryKey });
    };

    const bump = (key: QueryKey) => {
      pending.set(JSON.stringify(key), key);
      timer ??= setTimeout(flush, DEBOUNCE_MS);
    };

    const channel = supabase.channel("app");
    for (const table of TABLES) {
      channel.on<Row>(
        "postgres_changes",
        { event: "*", schema: "public", table },
        (payload) => {
          for (const key of keysForChange(table, rowOf(payload))) bump(key);
        },
      );
    }
    channel.subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      pending.clear();
      void supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return <>{children}</>;
}
