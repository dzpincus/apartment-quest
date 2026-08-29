"use client";

/**
 * `/chat` — every conversation in the hunt, with one of them open.
 *
 * It used to be the group thread and nothing else, which meant the only way to
 * read what somebody said about 214 Grand St was to remember which listing it
 * was and open its detail page. Now the left pane lists every thread that has
 * been spoken in (`thread_summaries()`, 0013) with the group thread pinned to
 * the top, and the right pane is the same `<Thread>` component the listing
 * page has always used.
 *
 * **The open thread is the URL**, `?t=<listingId>` (absent or `global` is the
 * group thread). That is what makes a thread shareable, a refresh survivable
 * and — under `md`, where only one pane fits — the Back button work: a phone
 * shows the list when there is no `t` and the thread when there is, so leaving
 * a thread is a history entry and not a piece of component state that a
 * browser back gesture would walk straight past.
 *
 * Heights are pinned to the viewport (`100dvh`, so a mobile browser bar cannot
 * hide the composer) and everything inside scrolls: a chat that pushes its own
 * text box off the bottom of a long page is unusable on a phone.
 */

import { Suspense, useMemo, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import { Thread } from "@/components/chat/thread";
import { ThreadHeader } from "@/components/chat/thread-header";
import { ThreadList } from "@/components/chat/thread-list";
import { useQueue } from "@/components/queue/use-queue";
import { Skeleton } from "@/components/ui/skeleton";
import { usePerson } from "@/lib/person";
import { useListings, useThreadSummaries, useUnread } from "@/lib/queries";
import { buildThreadList, GLOBAL_THREAD_KEY, listingIdFromThreadParam } from "@/lib/threads";

/** The two panes, minus the nav and the page padding. */
const PANE_HEIGHT = "h-[calc(100dvh-11.5rem)] min-h-80 md:h-[calc(100dvh-7.5rem)]";

/** Tailwind's `md`. The one breakpoint this page has an opinion about. */
const DESKTOP = "(min-width: 768px)";

function subscribeDesktop(onChange: () => void) {
  if (typeof window === "undefined") return () => {};
  const mq = window.matchMedia(DESKTOP);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/**
 * Both panes at `md` and up, one of them under it.
 *
 * This is a media query and not two CSS-hidden panes, because `<Thread>` marks
 * itself read on mount: a hidden-but-mounted thread would clear a badge for
 * messages nobody has seen. `false` on the server and for the first paint, so
 * a phone never renders a desktop layout it is about to throw away.
 */
function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia(DESKTOP).matches,
    () => false,
  );
}

export default function ChatPage() {
  return (
    // `useSearchParams` opts its subtree out of prerendering, so the read is
    // behind its own boundary — the same shape as `AddListingDialogSlot`.
    <Suspense fallback={<Skeleton className={`w-full ${PANE_HEIGHT}`} />}>
      <ChatWorkspace />
    </Suspense>
  );
}

function ChatWorkspace() {
  const params = useSearchParams();
  const raw = params.get("t");
  const openParam = raw && raw.length > 0 ? raw : null;
  const listingId = listingIdFromThreadParam(openParam);

  const isDesktop = useIsDesktop();
  const { people } = usePerson();
  const { now } = useQueue();

  const { data: summaries, isPending, error } = useThreadSummaries();
  const { data: listings } = useListings();
  const unread = useUnread();

  const items = useMemo(
    () => buildThreadList(summaries, listings, unread),
    [summaries, listings, unread],
  );

  // Straight out of the listings cache the thread list already needs — a
  // second fetch by id would be one request per thread anybody opens.
  const listing = listingId
    ? (listings?.find((row) => row.id === listingId) ?? null)
    : null;

  // Under `md` the param decides which pane exists; at `md` and up both do.
  const showList = isDesktop || openParam === null;
  const showThread = isDesktop || openParam !== null;

  return (
    <div className={`flex min-h-0 gap-4 ${PANE_HEIGHT}`}>
      {showList && (
        <ThreadList
          items={items}
          selectedKey={listingId ?? GLOBAL_THREAD_KEY}
          people={people}
          now={now}
          // Desktop skims; a phone navigates. Pushing under `md` is what makes
          // Back come out of a thread and into the list.
          replace={isDesktop}
          isPending={isPending}
          error={error}
          className="w-full shrink-0 md:w-72"
        />
      )}

      {showThread && (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <ThreadHeader listing={listing} listingId={listingId} people={people} />
          <Thread listingId={listingId} className="min-h-0 flex-1" />
        </div>
      )}
    </div>
  );
}
