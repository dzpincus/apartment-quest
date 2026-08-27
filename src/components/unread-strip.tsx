"use client";

/**
 * Home's "somebody said something" line, above the queue chips.
 *
 * The queue answers "what do I owe a broker today"; this answers "what did the
 * house say while I was out", which used to be visible only as a badge on a tab
 * you had to already be looking at. Two links, both counts, nothing when
 * everything is read — an empty strip on a screen whose whole point is the
 * queue would be a permanent shelf of nothing.
 *
 * Both numbers come from `unreadSummary` (pure, tested), the same helper the
 * nav badges use, so the strip and the tabs can never disagree.
 */

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useUnread } from "@/lib/queries";
import { unreadSummary } from "@/lib/unread";

function Item({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      // 44px on mobile: this is a thumb target, not a caption.
      className="flex min-h-11 flex-1 items-center justify-between gap-2 rounded-full bg-inset px-3.5 py-2 text-sm font-extrabold hover:bg-surface-hover md:min-h-0 md:py-1.5"
    >
      <span className="min-w-0 truncate">{children}</span>
      <ChevronRight className="size-4 shrink-0 text-primary" aria-hidden />
    </Link>
  );
}

export function UnreadStrip() {
  const { chatCount, listingIds } = unreadSummary(useUnread());
  if (chatCount === 0 && listingIds.length === 0) return null;

  return (
    <section
      aria-label="Unread"
      className="flex flex-col gap-2 rounded-[22px] border-2 border-primary/40 bg-card p-2 sm:flex-row"
    >
      {chatCount > 0 && (
        <Item href="/chat">
          💬 <span className="text-primary tabular-nums">{chatCount}</span> new in
          group chat
        </Item>
      )}
      {listingIds.length > 0 && (
        // One listing gets a direct line to its thread; several can only mean
        // "go and look", which is the listings table.
        <Item
          href={
            listingIds.length === 1 ? `/listings/${listingIds[0]}#thread` : "/listings"
          }
        >
          <span className="text-primary tabular-nums">{listingIds.length}</span>{" "}
          {listingIds.length === 1 ? "listing" : "listings"} with new messages
        </Item>
      )}
    </section>
  );
}
