"use client";

/**
 * One card of the follow-up queue. Everything the SPEC asks for is on it —
 * address, broker, the next action, who owns it, and one-tap "Log contact".
 * The border is the bucket's colour; the owner dot is the person's.
 */

import Link from "next/link";
import { PersonDot } from "@/components/person-dot";
import { GoneBadge } from "@/components/listings/gone-badge";
import { LogContactDialog } from "@/components/queue/log-contact-dialog";
import { listingLabel } from "@/lib/format";
import { coldFor, dueHint, type QueueBucket } from "@/lib/queue";
import { fmtDay, fmtNY } from "@/lib/time";
import type { ListingRow } from "@/lib/queries";
import { cn } from "@/lib/utils";

export function QueueRow({
  row,
  bucket,
  tone,
  today,
  now,
}: {
  row: ListingRow;
  bucket: QueueBucket;
  /** The bucket's colour, as a CSS value. */
  tone: string;
  today: string;
  now: Date;
}) {
  const hint = row.next_action_due
    ? dueHint(row.next_action_due, today)
    : coldFor(row.last_contacted_at, now);

  return (
    <div
      className="flex min-w-0 flex-col gap-3 overflow-hidden rounded-[20px] border-2 bg-card p-4"
      style={{ borderColor: tone }}
    >
      <div className="flex min-w-0 items-start gap-3">
        <div className="min-w-0 flex-1">
          {/* A listing can be overdue *and* gone — the due date wins the bucket
              (queue.ts), so the badge is what stops that from hiding the news.
              The address wraps rather than truncates: on a phone the unit
              number is the last thing on the line and the first thing cut. */}
          <span className="flex min-w-0 items-start gap-1.5">
            <Link
              href={`/listings/${row.id}`}
              className="min-w-0 line-clamp-2 break-words text-[17px] font-black underline-offset-4 hover:underline"
            >
              {listingLabel(row.address, row.unit)}
            </Link>
            <GoneBadge state={row.listing_state} note={row.state_note} listing={row} />
          </span>
          <p className="truncate text-xs text-muted-foreground">
            {row.broker?.name ?? "no broker"}
            {row.neighborhood ? ` · ${row.neighborhood}` : ""}
          </p>
        </div>
      </div>

      <div className="flex min-w-0 items-center justify-between gap-3 rounded-[14px] bg-inset px-3 py-2.5 text-sm">
        <span className={cn("min-w-0 flex-1 truncate", !row.next_action && "text-muted-foreground")}>
          {row.next_action || "— no next action"}
        </span>
        <span
          className="shrink-0 text-xs font-extrabold whitespace-nowrap"
          style={{ color: tone }}
          title={
            bucket === "cold" && row.last_contacted_at
              ? `last ${fmtNY(row.last_contacted_at, "MMM d")}`
              : row.next_action_due
                ? fmtDay(row.next_action_due, "MMM d, yyyy")
                : undefined
          }
        >
          {hint}
        </span>
      </div>

      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <PersonDot
          person={row.next_action_owner_person}
          withName
          className="shrink-0 text-xs font-extrabold text-muted-foreground"
        />
        <LogContactDialog listing={row} size="default" />
      </div>
    </div>
  );
}
