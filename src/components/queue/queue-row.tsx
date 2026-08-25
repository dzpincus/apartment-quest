"use client";

/**
 * One line of the follow-up queue: card under `md`, dense row at `md` and up.
 * Everything the SPEC asks for is on it — address, broker, the next action, who
 * owns it, and one-tap "Log contact".
 */

import Link from "next/link";
import { PersonDot } from "@/components/person-dot";
import { LogContactDialog } from "@/components/queue/log-contact-dialog";
import { listingLabel } from "@/lib/format";
import { coldFor, dueHint, type QueueBucket } from "@/lib/queue";
import { fmtDay, fmtNY } from "@/lib/time";
import type { ListingRow } from "@/lib/queries";
import { cn } from "@/lib/utils";

const HINT_TONE: Record<QueueBucket, string> = {
  overdue: "text-red-600 dark:text-red-400",
  today: "text-amber-600 dark:text-amber-400",
  cold: "text-muted-foreground",
};

export function QueueRow({
  row,
  bucket,
  today,
  now,
}: {
  row: ListingRow;
  bucket: QueueBucket;
  today: string;
  now: Date;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card p-3 md:flex-row md:items-center md:gap-4 md:py-2">
      <div className="min-w-0 md:flex-1">
        <Link
          href={`/listings/${row.id}`}
          className="block truncate font-medium underline-offset-4 hover:underline"
        >
          {listingLabel(row.address, row.unit)}
        </Link>
        <p className="truncate text-xs text-muted-foreground">
          {row.broker?.name ?? "no broker"}
          {row.neighborhood ? ` · ${row.neighborhood}` : ""}
        </p>
      </div>

      <div className="min-w-0 md:w-64 md:shrink-0">
        <p className={cn("truncate text-sm", !row.next_action && "text-muted-foreground")}>
          {row.next_action || "— no next action"}
        </p>
        <p className={cn("truncate text-xs", HINT_TONE[bucket])}>
          {row.next_action_due
            ? `${fmtDay(row.next_action_due)} · ${dueHint(row.next_action_due, today)}`
            : coldFor(row.last_contacted_at, now)}
          {bucket === "cold" && row.last_contacted_at
            ? ` · last ${fmtNY(row.last_contacted_at, "MMM d")}`
            : ""}
        </p>
      </div>

      <div className="flex items-center justify-between gap-3 md:shrink-0 md:justify-end">
        <PersonDot
          person={row.next_action_owner_person}
          withName
          className="text-xs text-muted-foreground"
        />
        <LogContactDialog listing={row} />
      </div>
    </div>
  );
}
