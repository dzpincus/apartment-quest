/**
 * Follow-up bucketing (SPEC: "Home — Follow-up queue").
 *
 * Pure on purpose: the home screen, the nav badge and vitest all bucket the
 * same rows, and nothing here may touch `new Date()` implicitly — callers pass
 * `todayNY` and `now` so the boundaries are testable.
 *
 * The three buckets, per SPEC:
 * - overdue: `next_action_due < today`
 * - today:   `next_action_due = today`
 * - cold:    `status = 'contacted'` and `last_contacted_at < now - 24h`
 *            and `next_action` is null
 *
 * A listing lands in at most one bucket (overdue > today > cold), merged rows
 * and dead statuses are excluded everywhere.
 */

import type { DateOnly, ListingStatus, Timestamptz, Uuid } from "@/lib/types";

const DAY_MS = 86_400_000;

/** 24 hours, not 4 days — NYC listings turn over inside 48 (SPEC). */
export const COLD_AFTER_MS = 24 * 60 * 60 * 1000;

/** Statuses that take a listing out of the queue for good. */
const CLOSED_STATUSES: ReadonlySet<ListingStatus> = new Set<ListingStatus>([
  "passed",
  "lost",
]);

export type QueueBucket = "overdue" | "today" | "cold";

/** The columns bucketing reads. Anything wider (a `ListingRow`) satisfies it. */
export type QueueFields = {
  status: ListingStatus | null;
  merged_into: Uuid | null;
  next_action: string | null;
  next_action_due: DateOnly | null;
  last_contacted_at: Timestamptz | null;
};

export type Buckets<T> = { overdue: T[]; today: T[]; cold: T[] };

/**
 * `yyyy-MM-dd` → ms at UTC midnight. Only ever compared against another day
 * built the same way, so the zone is irrelevant — this is calendar math, and
 * turning a date-only column into an instant is what causes the classic
 * off-by-one-day bug.
 */
export function dayMs(day: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  if (!m) return Number.NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Whole days from `from` to `to`; negative when `to` is in the past. */
export function daysBetween(from: string, to: string): number {
  return Math.round((dayMs(to) - dayMs(from)) / DAY_MS);
}

/** "2d overdue" / "today" / "tomorrow" / "in 3d" — the hint next to a due date. */
export function dueHint(due: DateOnly, today: string): string {
  const diff = daysBetween(today, due);
  if (Number.isNaN(diff)) return "";
  if (diff < 0) return `${-diff}d overdue`;
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  return `in ${diff}d`;
}

/** How long a cold listing has been quiet: "2d quiet" / "31h quiet". */
export function coldFor(lastContactedAt: Timestamptz | null, now: Date): string {
  if (!lastContactedAt) return "never contacted";
  const ms = now.getTime() - Date.parse(lastContactedAt);
  if (Number.isNaN(ms)) return "";
  const hours = Math.floor(ms / 3_600_000);
  return hours >= 48 ? `${Math.floor(hours / 24)}d quiet` : `${hours}h quiet`;
}

function hasText(v: string | null | undefined): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

export function bucketListings<T extends QueueFields>(
  listings: readonly T[],
  { todayNY, now }: { todayNY: string; now: Date },
): Buckets<T> {
  const today = dayMs(todayNY);
  const coldBefore = now.getTime() - COLD_AFTER_MS;
  const out: Buckets<T> = { overdue: [], today: [], cold: [] };

  for (const listing of listings) {
    if (listing.merged_into) continue;
    if (listing.status && CLOSED_STATUSES.has(listing.status)) continue;

    const due = listing.next_action_due ? dayMs(listing.next_action_due) : Number.NaN;
    if (!Number.isNaN(due)) {
      // A due date means somebody already scheduled this: it is either late,
      // it is today, or it is in the future and none of our business yet.
      if (due < today) out.overdue.push(listing);
      else if (due === today) out.today.push(listing);
      continue;
    }

    const last = listing.last_contacted_at ? Date.parse(listing.last_contacted_at) : Number.NaN;
    const cold =
      listing.status === "contacted" &&
      !hasText(listing.next_action) &&
      !Number.isNaN(last) &&
      last < coldBefore;
    if (cold) out.cold.push(listing);
  }

  // Worst first in every bucket: oldest due date, then longest silence.
  out.overdue.sort((a, b) => dayMs(a.next_action_due!) - dayMs(b.next_action_due!));
  out.cold.sort(
    (a, b) => Date.parse(a.last_contacted_at!) - Date.parse(b.last_contacted_at!),
  );
  return out;
}

/** Overdue + today: the number that belongs on the Home tab (SPEC: one badge). */
export function needsAttentionCount<T>(buckets: Buckets<T>): number {
  return buckets.overdue.length + buckets.today.length;
}
