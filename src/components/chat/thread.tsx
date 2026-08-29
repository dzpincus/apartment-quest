"use client";

/**
 * One message thread, used for both the global chat (`listingId: null`) and a
 * listing's own thread. The caller owns the height — `/chat` gives it the
 * viewport, the listing detail page gives it half — and everything inside
 * scrolls.
 *
 * Realtime keeps the query fresh (see `lib/realtime.tsx`); this component only
 * decides where to scroll and when the thread counts as read.
 *
 * Reactions (0014) hang under each bubble in their own row inside the
 * per-message wrapper. They deliberately do not disturb the scroll: the
 * "follow along" effect below keys on the *last message id*, and a reaction
 * does not make a new message — so somebody reading the backlog is never
 * yanked to the bottom because somebody else tapped 🔥.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, SendHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { PersonDot } from "@/components/person-dot";
import { MessageReactions } from "@/components/chat/message-reactions";
import { usePerson } from "@/lib/person";
import { useListing, useMessages } from "@/lib/queries";
import { useMutations } from "@/lib/mutations";
import { groupMessages } from "@/lib/chat";
import { listingLabel } from "@/lib/format";
import { fmtNY } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { Uuid } from "@/lib/types";

/** Within this many pixels of the bottom still counts as "following along". */
const AT_BOTTOM_SLOP = 48;

export function Thread({
  listingId,
  className,
}: {
  /** `null` is the global thread. */
  listingId: Uuid | null;
  className?: string;
}) {
  const { person } = usePerson();
  const { data, isPending, error } = useMessages(listingId);
  const { postMessage, markThreadRead } = useMutations(person?.id);

  const messages = useMemo(() => data ?? [], [data]);
  const groups = useMemo(() => groupMessages(messages), [messages]);
  const lastMessage = messages[messages.length - 1];
  const lastId = lastMessage?.id ?? null;

  // Only for the activity summary. On the listing page this is the same cache
  // entry the page itself reads, so it costs nothing; on /chat it is disabled.
  const listing = useListing(listingId ?? undefined).data;
  const label = listing ? listingLabel(listing.address, listing.unit) : null;

  const listRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const seenRef = useRef<string | null>(null);
  const [hasNew, setHasNew] = useState(false);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
    atBottomRef.current = true;
    setHasNew(false);
  }, []);

  const onScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const atBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight <= AT_BOTTOM_SLOP;
    atBottomRef.current = atBottom;
    if (atBottom) setHasNew(false);
  }, []);

  /**
   * Jump to the bottom on first load and for your own messages; otherwise only
   * if you were already at the bottom. Yanking someone away from the backlog
   * they are reading is worse than a pill they can ignore.
   */
  useEffect(() => {
    if (!lastId || seenRef.current === lastId) return;
    const first = seenRef.current === null;
    const mine = lastMessage?.person_id === person?.id;
    seenRef.current = lastId;
    if (first || mine || atBottomRef.current) scrollToBottom(first ? "instant" : "smooth");
    else setHasNew(true);
  }, [lastId, lastMessage?.person_id, person?.id, scrollToBottom]);

  /**
   * Mark read on mount and whenever a new message lands — but only while the
   * tab is actually being looked at, so a background tab does not silently
   * clear a badge nobody saw. Re-checked when the tab becomes visible again.
   */
  const markRead = markThreadRead.mutate;
  const personId = person?.id;
  const markedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!personId || !lastId) return;
    const mark = () => {
      if (document.visibilityState !== "visible") return;
      if (markedRef.current === lastId) return;
      markedRef.current = lastId;
      markRead(listingId);
    };
    mark();
    document.addEventListener("visibilitychange", mark);
    return () => document.removeEventListener("visibilitychange", mark);
  }, [personId, lastId, listingId, markRead]);

  const [draft, setDraft] = useState("");
  const trimmed = draft.trim();
  const canSend = trimmed.length > 0 && Boolean(person) && !postMessage.isPending;

  function send() {
    if (!canSend) return;
    setDraft("");
    postMessage.mutate(
      { listingId, body: trimmed, label },
      // Put the words back rather than losing them to a dropped connection.
      { onError: () => setDraft((current) => current || trimmed) },
    );
  }

  return (
    <div className={cn("relative flex min-h-0 flex-col overflow-hidden", className)}>
      <div
        ref={listRef}
        onScroll={onScroll}
        className="flex-1 space-y-3 overflow-y-auto overscroll-contain px-1 py-2"
      >
        {isPending && <Skeleton className="h-20 w-full" />}
        {error && (
          <p className="text-sm text-destructive">
            Could not load the thread: {String((error as Error).message)}
          </p>
        )}
        {!isPending && !error && messages.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {listingId ? "Nothing about this listing yet." : "Nothing here yet."} Say
            something.
          </p>
        )}

        {groups.map((group) => {
          const first = group.items[0];
          const mine = group.personId === person?.id;
          const color = first.person?.color ?? "#888";

          if (mine) {
            return (
              <div key={group.key} className="flex flex-col items-end gap-1">
                {group.items.map((message) => (
                  <div
                    key={message.id}
                    className="group/message flex w-full flex-col items-end gap-1"
                  >
                    <p
                      title={
                        message.created_at
                          ? fmtNY(message.created_at, "MMM d, h:mm a")
                          : undefined
                      }
                      className="w-fit max-w-[85%] rounded-[18px] rounded-br-[4px] px-3.5 py-2.5 text-sm break-words whitespace-pre-wrap text-ink"
                      style={{ backgroundColor: color }}
                    >
                      {message.body}
                    </p>
                    <MessageReactions message={message} align="end" />
                  </div>
                ))}
                <span className="pr-1 text-[10px] tabular-nums text-faint">
                  {group.startedAt ? fmtNY(group.startedAt, "MMM d, h:mm a") : ""}
                </span>
              </div>
            );
          }

          return (
            <div key={group.key} className="flex items-end gap-2">
              <PersonDot person={first.person} size="lg" className="mb-5" />
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-[11px] font-extrabold" style={{ color }}>
                  {first.person?.name ?? "Someone"}
                </span>
                {group.items.map((message) => (
                  <div key={message.id} className="group/message flex flex-col gap-1">
                    <p
                      title={
                        message.created_at
                          ? fmtNY(message.created_at, "MMM d, h:mm a")
                          : undefined
                      }
                      className="w-fit max-w-[85%] rounded-[18px] rounded-bl-[4px] border-2 bg-card px-3.5 py-2.5 text-sm break-words whitespace-pre-wrap"
                      style={{ borderColor: color }}
                    >
                      {message.body}
                    </p>
                    <MessageReactions message={message} />
                  </div>
                ))}
                <span className="text-[10px] tabular-nums text-faint">
                  {group.startedAt ? fmtNY(group.startedAt, "MMM d, h:mm a") : ""}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {hasNew && (
        <Button
          size="sm"
          variant="secondary"
          className="absolute bottom-16 left-1/2 -translate-x-1/2 shadow-lg"
          onClick={() => scrollToBottom()}
        >
          New messages
          <ArrowDown />
        </Button>
      )}

      <form
        className="flex items-end gap-2 pt-2"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends, Shift+Enter is a newline. `isComposing` keeps an IME
            // candidate selection from posting half a word.
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              send();
            }
          }}
          rows={1}
          placeholder={listingId ? "Message about this listing…" : "Message…"}
          aria-label="Message"
          disabled={!person}
          className="max-h-32 min-h-11 resize-none rounded-[22px] border-2 bg-card px-4 py-2.5"
        />
        <Button
          type="submit"
          size="icon-lg"
          disabled={!canSend}
          aria-label="Send"
          className="shrink-0"
        >
          <SendHorizontal />
        </Button>
      </form>
    </div>
  );
}
