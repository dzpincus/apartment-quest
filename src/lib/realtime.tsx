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

/**
 * Every table in the `supabase_realtime` publication (0003_rpc_triggers.sql,
 * extended by 0004_review_fixes.sql). Adding one here without adding it to the
 * publication is a channel that never fires; adding it to the publication
 * without adding it here is a change nobody hears.
 */
const TABLES = [
  "messages",
  "listings",
  "votes",
  "activity",
  "interactions",
  "brokers",
  "people",
  "listing_photos",
  "locations",
  "commute_times",
  "spotlights",
] as const;
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
    case "listing_photos": {
      // Photos are embedded in the listing row (`LISTING_SELECT`), so they have
      // no key of their own: the gallery, the cards and the table all read them
      // from `listings` / `listing(id)`. This is what makes the import path
      // work — the dialog navigates to the detail page while `/api/photos` is
      // still uploading, and each insert pops another thumbnail into the strip.
      //
      // A DELETE under the default replica identity carries only the primary
      // key, so `listing_id` is absent and the table-wide key has to do.
      const listingId = id(row, "listing_id");
      return listingId
        ? [queryKeys.listings, queryKeys.listing(listingId)]
        : [queryKeys.listings];
    }
    case "locations":
      // The saved places are their own list, read by the map's chip row and by
      // the commute card. Adding one also fills a whole column of
      // `commute_times`, but those arrive as their own events below.
      return [queryKeys.locations];
    case "commute_times": {
      // Commute times are embedded in the listing row (`LISTING_SELECT`), so
      // they have no key of their own — same shape as photos. This is what
      // makes a batch run fill the card in live rather than after a refresh.
      //
      // A DELETE under the default replica identity carries only the primary
      // key — which here is the whole of (listing_id, location_id, mode), so
      // `listing_id` is present even then and the narrow key still works.
      const listingId = id(row, "listing_id");
      return listingId
        ? [queryKeys.listings, queryKeys.listing(listingId)]
        : [queryKeys.listings];
    }
    case "spotlights": {
      // Spotlights (0012) are embedded in the listing row too, so they have no
      // key of their own — same shape as photos and commute times. This is what
      // puts somebody else's "Look at this one!" on your Home strip without a
      // refresh, since Home reads it out of the `listings` entry the queue
      // already holds.
      //
      // A DELETE under the default replica identity carries only the primary
      // key, which here is `person_id` alone — so `listing_id` is absent and the
      // table-wide key has to do. That is the *common* case for this table
      // ("Remove spotlight"), not an edge one, and `["listings"]` covers it.
      const listingId = id(row, "listing_id");
      return listingId
        ? [queryKeys.listings, queryKeys.listing(listingId)]
        : [queryKeys.listings];
    }
    case "brokers":
      // The broker list *and* the listings: `LISTING_SELECT` embeds the broker
      // columns, so a renamed brokerage is stale on every row it is attached to.
      return [queryKeys.brokers, queryKeys.listings];
    case "people":
      // Names and colours are read from `usePerson().people`, and incomes feed
      // the qualification badge — all of it hangs off this one key.
      return [queryKeys.people];
    default: {
      // Unreachable for `Table`, and the assignment keeps it that way: adding a
      // table to TABLES without a case above is a type error here rather than a
      // silent `undefined` handed to the caller's `for...of`.
      const unhandled: never = table;
      void unhandled;
      return [];
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
