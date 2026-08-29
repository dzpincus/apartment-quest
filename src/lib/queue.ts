/**
 * Follow-up bucketing (SPEC: "Home — Follow-up queue").
 *
 * Pure on purpose: the home screen, the nav badge and vitest all bucket the
 * same rows, and nothing here may touch `new Date()` implicitly — callers pass
 * `todayNY` and `now` so the boundaries are testable.
 *
 * The five buckets:
 * - overdue:  `next_action_due < today`
 * - today:    `next_action_due = today`
 * - vanished: the source page says `off_market` / `removed` (0006)
 * - cold:     `status = 'contacted'` and `last_contacted_at < now - 24h`
 *             and `next_action` is null
 * - fresh:    `status = 'saved'` with no next action and nothing scheduled —
 *             somebody added it and nobody has picked it up yet
 *
 * A listing lands in at most one bucket (overdue > today > vanished > cold >
 * fresh), merged rows and dead statuses are excluded everywhere.
 *
 * Vanished sits *under* the two date buckets on purpose: a commitment somebody
 * made for today outranks the news, and the row carries a "gone?" badge in
 * whichever bucket it lands in, so nothing is hidden by the ordering. It sits
 * *over* cold because "the listing disappeared" is a better explanation of
 * silence than "nobody has called".
 */

import type { DateOnly, ListingState, ListingStatus, Timestamptz, Uuid } from "@/lib/types";

const DAY_MS = 86_400_000;

/** 24 hours, not 4 days — NYC listings turn over inside 48 (SPEC). */
export const COLD_AFTER_MS = 24 * 60 * 60 * 1000;

/** Statuses that take a listing out of the queue for good. */
const CLOSED_STATUSES: ReadonlySet<ListingStatus> = new Set<ListingStatus>([
  "passed",
  "lost",
]);

export type QueueBucket = "overdue" | "today" | "vanished" | "cold" | "fresh";

/** The columns bucketing reads. Anything wider (a `ListingRow`) satisfies it. */
export type QueueFields = {
  status: ListingStatus | null;
  merged_into: Uuid | null;
  next_action: string | null;
  next_action_due: DateOnly | null;
  last_contacted_at: Timestamptz | null;
  listing_state: ListingState | null;
  state_checked_at: Timestamptz | null;
  /** Only `fresh` reads this, and only to sort: newest addition first. */
  created_at: Timestamptz | null;
};

export type Buckets<T> = {
  overdue: T[];
  today: T[];
  vanished: T[];
  cold: T[];
  fresh: T[];
};

/** The two states that mean the source page stopped offering the apartment. */
const GONE_STATES: ReadonlySet<ListingState> = new Set<ListingState>([
  "off_market",
  "removed",
]);

/**
 * Does the *page* say this listing is gone? Never consults `status` — that is
 * ours to decide, and `bucketListings` has already dropped the dead ones.
 */
export function isVanished(listing: Pick<QueueFields, "listing_state">): boolean {
  return listing.listing_state != null && GONE_STATES.has(listing.listing_state);
}

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
  const out: Buckets<T> = {
    overdue: [],
    today: [],
    vanished: [],
    cold: [],
    fresh: [],
  };

  for (const listing of listings) {
    if (listing.merged_into) continue;
    if (listing.status && CLOSED_STATUSES.has(listing.status)) continue;

    // A due date means somebody already scheduled this: it is either late, it
    // is today, or it is in the future.
    const due = listing.next_action_due ? dayMs(listing.next_action_due) : Number.NaN;
    if (!Number.isNaN(due)) {
      if (due < today) {
        out.overdue.push(listing);
        continue;
      }
      if (due === today) {
        out.today.push(listing);
        continue;
      }
    }

    // A listing whose page disappeared needs a person either way, and a due
    // date next Tuesday is not a reason to sit on that until Tuesday.
    if (isVanished(listing)) {
      out.vanished.push(listing);
      continue;
    }

    // A future due date is a commitment already made: not Cold, not ours yet.
    if (!Number.isNaN(due)) continue;

    const last = listing.last_contacted_at ? Date.parse(listing.last_contacted_at) : Number.NaN;
    const cold =
      listing.status === "contacted" &&
      !hasText(listing.next_action) &&
      !Number.isNaN(last) &&
      last < coldBefore;
    if (cold) {
      out.cold.push(listing);
      continue;
    }

    // Nothing above claimed it: still `saved`, nobody has written down what
    // happens next. That is a listing somebody dropped on the board and walked
    // away from, and the whole prompt is the "Log contact" button on the row.
    // Lowest precedence by construction — this is the last thing the loop
    // tries. A row with a due date has already `continue`d above: a commitment
    // already made is not new, for the same reason it is not cold.
    if (listing.status === "saved" && !hasText(listing.next_action)) {
      out.fresh.push(listing);
    }
  }

  // Worst first in every bucket: oldest due date, then longest silence.
  out.overdue.sort((a, b) => dayMs(a.next_action_due!) - dayMs(b.next_action_due!));
  out.cold.sort(
    (a, b) => Date.parse(a.last_contacted_at!) - Date.parse(b.last_contacted_at!),
  );
  // Vanished is newest-first: this bucket is news, and the freshest news is
  // the row somebody has not seen yet. A never-checked row (impossible in
  // practice — a state comes from a check) sorts last rather than first.
  out.vanished.sort((a, b) => checkedAt(b) - checkedAt(a));
  // Fresh is newest-first: the listing added this morning is the one still
  // worth calling about. A row with no `created_at` sorts last rather than
  // jumping the queue.
  out.fresh.sort((a, b) => createdAt(b) - createdAt(a));
  return out;
}

function checkedAt(listing: QueueFields): number {
  const ms = listing.state_checked_at ? Date.parse(listing.state_checked_at) : Number.NaN;
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

function createdAt(listing: QueueFields): number {
  const ms = listing.created_at ? Date.parse(listing.created_at) : Number.NaN;
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

const SMALL_NUMBERS = [
  "Nothing",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
] as const;

/**
 * The home screen's one line of copy, driven by `needsAttentionCount`. Pure so
 * the number and the words can never disagree.
 */
export function queueSubtitle(count: number): string {
  if (count <= 0) return "Nothing on fire. Go touch grass.";
  const n = count < SMALL_NUMBERS.length ? SMALL_NUMBERS[count] : String(count);
  return `${n} thing${count === 1 ? "" : "s"} to poke at today.`;
}

/**
 * Overdue + today: the number that belongs on the Home tab (SPEC: one badge).
 * Vanished is deliberately not counted — it is news, not a deadline, and a
 * permanent red dot for "somebody should look at this eventually" is how a
 * badge stops meaning anything. `fresh` is out for the same reason, and more
 * so: every listing starts there, so counting it would put a permanent number
 * on the tab that only ever grows.
 */
export function needsAttentionCount<T>(buckets: Buckets<T>): number {
  return buckets.overdue.length + buckets.today.length;
}

/**
 * Which bucket a listing landed in, or null for one that landed in none —
 * applied, toured, passed, lost, or contacted with an action that is not due
 * yet. `bucketListings` already decided; this only asks it.
 *
 * `/chat` needs the answer for a card it draws outside Home: the same queue
 * card, at the top of a listing's thread, in the colour of whatever it is
 * doing. Scanning five short arrays is cheaper than a second pass over the
 * rows, and putting the search here rather than in the component is what keeps
 * "at most one bucket" a fact with a test on it.
 */
export function bucketOf<T extends { id: string }>(
  buckets: Buckets<T>,
  listingId: string,
): QueueBucket | null {
  for (const bucket of BUCKET_ORDER) {
    if (buckets[bucket].some((row) => row.id === listingId)) return bucket;
  }
  return null;
}

/** Precedence order, which is also the order Home draws the chips in. */
export const BUCKET_ORDER: readonly QueueBucket[] = [
  "overdue",
  "today",
  "vanished",
  "cold",
  "fresh",
] as const;

/**
 * One colour per bucket, used for the chip on Home, the border of every card
 * under it, and the same card wherever else it is drawn (the thread header on
 * `/chat`). Semantic tokens only — a bucket must never look like a housemate,
 * which is why `fresh` is `--fresh` and not `--yes`.
 *
 * `null` — a listing in no bucket at all — is the plain border: nothing is
 * happening to it, and a colour would be a claim.
 */
export const BUCKET_TONE: Record<QueueBucket, string> = {
  overdue: "var(--urgent)",
  today: "var(--due)",
  cold: "var(--quiet)",
  // Neither is on fire, both want a person eventually, so Vanished shares the
  // quiet blue with Gone quiet.
  vanished: "var(--quiet)",
  fresh: "var(--fresh)",
};

/** The bucket's colour, or the resting border for a listing in none. */
export function bucketTone(bucket: QueueBucket | null): string {
  return bucket ? BUCKET_TONE[bucket] : "var(--border)";
}
