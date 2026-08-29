"use client";

/**
 * Browser notifications for new messages, mounted once in `(app)/layout.tsx`.
 *
 * **Its own channel, on purpose.** `RealtimeProvider` is invalidation-only by
 * rule (CLAUDE.md → Architectural rules): it turns a `postgres_changes` payload
 * into a query key and reads nothing out of the row. This one does the
 * opposite — it needs the body, the author and the thread — and folding it into
 * that provider would put a "and also, if it is a message, and the tab is
 * hidden, and…" branch inside the one function whose whole value is that it
 * only ever decides a key. Two subscriptions ride the same websocket
 * (`createBrowserClient` memoizes per url+key), so the second channel costs a
 * `phx_join`, not a connection.
 *
 * **Not Web Push.** No service worker, no VAPID, no subscription stored
 * anywhere: notifications only happen while a tab is open. That is the whole
 * feature, and it is why `NotifyToggle` says what it says on an iPhone.
 *
 * The decision lives in `src/lib/notifications.ts` and is tested there.
 */

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { usePerson } from "@/lib/person";
import { useNotifyEnabled } from "@/lib/prefs";
import { queryKeys, type ListingRow } from "@/lib/queries";
import { listingLabel } from "@/lib/format";
import {
  hrefForMessage,
  isThreadOnScreen,
  notificationBody,
  notificationPermission,
  shouldNotify,
} from "@/lib/notifications";
import type { Person } from "@/lib/types";

type MessageInsert = {
  id?: string;
  person_id?: string | null;
  listing_id?: string | null;
  body?: string | null;
};

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { person, people } = usePerson();
  const [enabled] = useNotifyEnabled(person?.id);

  /**
   * Everything the handler reads lives behind a ref, so switching a preference
   * or loading the roster does not tear the channel down and re-subscribe. The
   * effect below has no reactive dependencies at all for the same reason: a
   * websocket that re-joins every time somebody's name arrives is a websocket
   * that drops the message it was mounted for.
   */
  const state = useRef({ person, people, enabled, router, queryClient });
  useEffect(() => {
    state.current = { person, people, enabled, router, queryClient };
  });

  useEffect(() => {
    const supabase = createClient();

    const onInsert = (payload: RealtimePostgresChangesPayload<MessageInsert>) => {
      const message = (payload.new ?? {}) as MessageInsert;
      const { person: me, people: roster, enabled: on, router: nav } = state.current;

      const params = new URLSearchParams(window.location.search);
      const open = isThreadOnScreen(
        message.listing_id ?? null,
        window.location.pathname,
        params.get("t"),
      );

      if (
        !shouldNotify({
          message,
          myPersonId: me?.id,
          enabled: on,
          permission: notificationPermission(),
          visible: document.visibilityState === "visible",
          currentThreadOpen: open,
        })
      ) {
        return;
      }

      const author: Person | null =
        roster.find((p) => p.id === message.person_id) ?? null;
      const { title, body, tag } = notificationBody(
        message,
        author?.name,
        labelFor(state.current.queryClient, message.listing_id ?? null),
      );
      const href = hrefForMessage(message.listing_id ?? null);

      try {
        const notification = new window.Notification(title, {
          body,
          tag,
          icon: "/icon-192.png",
        });
        notification.onclick = () => {
          window.focus();
          nav.push(href);
          notification.close();
        };
      } catch {
        // Chrome on Android throws for `new Notification` outside a service
        // worker, and this app has none. Losing a banner is not worth an
        // uncaught error in the console of a browser that was never going to
        // show it.
      }
    };

    const channel = supabase.channel("notify");
    channel.on<MessageInsert>(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages" },
      onInsert,
    );
    channel.subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
    // Mount-once: everything mutable is read through `state.current`.
  }, []);

  return <>{children}</>;
}

/**
 * The listing's address, out of the cache the listings page and the queue
 * already hold — never a new request, because a notification must not cost a
 * round trip. A listing nobody has loaded yet gets a generic word rather than
 * an id.
 */
function labelFor(
  queryClient: ReturnType<typeof useQueryClient>,
  listingId: string | null,
): string | null {
  if (!listingId) return null;
  const one = queryClient.getQueryData<ListingRow | null>(queryKeys.listing(listingId));
  if (one) return listingLabel(one.address, one.unit);
  const all = queryClient.getQueryData<ListingRow[]>(queryKeys.listings);
  const row = all?.find((listing) => listing.id === listingId);
  return row ? listingLabel(row.address, row.unit) : "a listing";
}
