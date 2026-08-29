"use client";

/**
 * The left pane of `/chat`: every conversation, group thread pinned first.
 *
 * A row is a `<Link>` and not a button, because the open thread is a URL
 * (`?t=<listingId>`) — so a row can be middle-clicked, a thread can be shared,
 * and Back on a phone comes out of the thread and into this list. Whether that
 * link replaces the current history entry or pushes a new one is the caller's
 * call: pushing is what makes Back work under `md`, replacing is what stops a
 * desktop from stacking twenty entries while somebody skims.
 *
 * Ordering, labels and unread counts are `buildThreadList`'s
 * (`src/lib/threads.ts`, pure and tested); nothing is decided here.
 */

import Link from "next/link";
import { Users } from "lucide-react";
import { PersonDot } from "@/components/person-dot";
import { UnreadBadge } from "@/components/unread-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { threadHref, type ThreadListItem } from "@/lib/threads";
import { timeAgo } from "@/lib/time";
import type { Person } from "@/lib/types";
import { cn } from "@/lib/utils";

export function ThreadList({
  items,
  /** `"global"` or a listing id — `ThreadListItem.key`. */
  selectedKey,
  people,
  now,
  replace,
  isPending,
  error,
  className,
}: {
  items: ThreadListItem[];
  selectedKey: string;
  people: Person[];
  now: Date;
  /** Replace the history entry instead of pushing one. Desktop does. */
  replace: boolean;
  isPending?: boolean;
  error?: unknown;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-0 min-w-0 flex-col", className)}>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain pr-1">
        {error ? (
          <p className="px-2 py-3 text-sm text-destructive">
            Could not load the threads: {String((error as Error).message)}
          </p>
        ) : null}
        {isPending && !error && <Skeleton className="h-16 w-full" />}

        {items.map((item) => (
          <ThreadRow
            key={item.key}
            item={item}
            selected={item.key === selectedKey}
            people={people}
            now={now}
            replace={replace}
          />
        ))}
      </div>
    </div>
  );
}

function ThreadRow({
  item,
  selected,
  people,
  now,
  replace,
}: {
  item: ThreadListItem;
  selected: boolean;
  people: Person[];
  now: Date;
  replace: boolean;
}) {
  const isGlobal = item.listingId === null;
  // The roster is humans-only (`PersonProvider` filters the bot out), and a
  // message is always written by one of them — but a person who has been
  // removed from the table must not take the list down with them.
  const lastPerson = item.lastPersonId
    ? (people.find((p) => p.id === item.lastPersonId) ?? null)
    : null;

  return (
    <Link
      href={threadHref(item.listingId)}
      replace={replace}
      aria-current={selected ? "true" : undefined}
      className={cn(
        // The 3px left rail is the table's selection language, reused: a border
        // that is always there and only sometimes coloured, so nothing shifts
        // sideways when a row is picked.
        "flex min-w-0 items-start gap-2.5 rounded-[14px] border-l-[3px] border-transparent px-2.5 py-2.5 hover:bg-surface-hover",
        selected && "border-l-primary bg-surface-hover",
      )}
    >
      <span className="mt-0.5 shrink-0">
        {isGlobal ? (
          <span
            className="flex size-5.5 items-center justify-center rounded-full bg-inset text-muted-foreground"
            aria-hidden
          >
            <Users className="size-3.5" strokeWidth={2.5} />
          </span>
        ) : lastPerson ? (
          <PersonDot person={lastPerson} size="lg" />
        ) : (
          <span className="block size-5.5 rounded-full bg-inset" aria-hidden />
        )}
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-extrabold">{item.label}</span>
          <span className="shrink-0 text-[10px] tabular-nums text-faint">
            {item.lastAt ? timeAgo(item.lastAt, now) : ""}
          </span>
        </span>
        {item.sublabel && (
          <span className="truncate text-[11px] text-muted-foreground">{item.sublabel}</span>
        )}
        <span className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-xs",
              item.unreadCount > 0 ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {item.lastBody?.trim() || "No messages yet"}
          </span>
          <UnreadBadge count={item.unreadCount} className="shrink-0" />
        </span>
      </span>
    </Link>
  );
}
