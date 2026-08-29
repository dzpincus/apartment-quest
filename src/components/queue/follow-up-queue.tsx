"use client";

/**
 * Home is the follow-up queue, not a listing gallery (SPEC). Five buckets,
 * always all five, each with its count — an empty Overdue chip is the point of
 * the screen, not something to hide.
 *
 * At rest the screen *is* the counts: one wrapping row of chips and no rows at
 * all. Tapping a chip opens that bucket underneath it; tapping the same chip
 * again closes it, and only one is ever open. Five stacked lists pushed the
 * activity feed off the bottom of the phone; collapsed, "what is on fire" and
 * "what did the house do" fit on one screen.
 *
 * Each bucket owns one colour (coral late / yellow now / blue quiet / mint
 * new), used for the chip and for the border of every card under it. Selected
 * is that colour filled with dark ink — the old section header, unchanged —
 * and unselected is the same colour as an outline. Vanished? shares the quiet
 * blue with Gone quiet: neither is on fire, both want a person eventually. It
 * sits before New, which is last, because neither is a deadline — and for the
 * same reason neither is in the nav badge.
 *
 * A sixth chip, **Mine**, is not a bucket: it filters all five to the listings
 * this person is named on (`next_action_owners`, 0014) and is a device
 * preference (`aq.queue.mine:<personId>`), so switching it on cannot hide
 * anybody else's work from them. It wears the person's own colour rather than a
 * semantic token, because that is exactly what it means. The nav badge is
 * deliberately left unfiltered — a deadline belongs to the house.
 */

import { useCallback, useSyncExternalStore } from "react";
import { QueueRow } from "@/components/queue/queue-row";
import { VanishedRow } from "@/components/queue/vanished-row";
import { useQueue } from "@/components/queue/use-queue";
import { usePerson } from "@/lib/person";
import { useQueueMine } from "@/lib/prefs";
import { BUCKET_TONE, filterMine, type QueueBucket } from "@/lib/queue";
import type { ListingRow } from "@/lib/queries";
import { cn } from "@/lib/utils";

/**
 * The five chips. The colours come from `BUCKET_TONE` (`lib/queue.ts`) rather
 * than being written here, because the same card is now drawn in a second
 * place — the thread header on `/chat` — and two lists of five hexes is one
 * list too many.
 */
const BUCKETS: ReadonlyArray<{
  bucket: QueueBucket;
  title: string;
  /** CSS colour token; also the border of the cards in this bucket. */
  tone: string;
}> = [
  { bucket: "overdue", title: "Overdue", tone: BUCKET_TONE.overdue },
  { bucket: "today", title: "Today", tone: BUCKET_TONE.today },
  { bucket: "cold", title: "Gone quiet", tone: BUCKET_TONE.cold },
  { bucket: "vanished", title: "Vanished?", tone: BUCKET_TONE.vanished },
  // Its own mint, not `--yes` — that one is a person's colour as well as a
  // vote's, and a bucket must never look like a housemate.
  { bucket: "fresh", title: "New", tone: BUCKET_TONE.fresh },
];

const STORAGE_KEY = "aq.homeBucket";

/**
 * Which chip is open, as an external store: a module variable that React reads
 * through `useSyncExternalStore` (no setState-in-effect, no hydration
 * mismatch) and that writes itself through to localStorage so a reload comes
 * back to the same open bucket. Memory is the source of truth, not storage —
 * a browser with storage switched off still toggles, it just forgets.
 */
let selected: QueueBucket | null | undefined;
const listeners = new Set<() => void>();

/** null for anything that is not one of the five, and for storage that throws. */
function readStorage(): QueueBucket | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return BUCKETS.some((b) => b.bucket === raw) ? (raw as QueueBucket) : null;
  } catch {
    return null;
  }
}

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    // `key === null` is a whole-storage clear, which does concern us.
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    selected = readStorage();
    onChange();
  };
  listeners.add(onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): QueueBucket | null {
  if (selected === undefined) selected = readStorage();
  return selected;
}

/** Nothing is open on the server, so nothing flashes open before hydration. */
function getServerSnapshot(): QueueBucket | null {
  return null;
}

function select(bucket: QueueBucket | null) {
  selected = bucket;
  try {
    if (bucket) window.localStorage.setItem(STORAGE_KEY, bucket);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage off or full: this session still remembers, the next one won't.
  }
  for (const listener of listeners) listener();
}

export function FollowUpQueue() {
  const { buckets: all, today, now, isPending, error } = useQueue();
  const open = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const { person } = usePerson();
  const [mine, setMine] = useQueueMine(person?.id);

  // Every count on screen is read off this, so the chips can never disagree
  // with the rows under them.
  const buckets = mine ? filterMine(all, person?.id) : all;

  const toggle = useCallback(
    (bucket: QueueBucket) => select(getSnapshot() === bucket ? null : bucket),
    [],
  );

  if (error) {
    return (
      <p className="text-sm text-destructive">
        Could not load the queue: {String((error as Error).message)}
      </p>
    );
  }

  const section = BUCKETS.find((b) => b.bucket === open);
  const rows: ListingRow[] = section ? buckets[section.bucket] : [];

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {BUCKETS.map((b) => {
          const active = b.bucket === open;
          return (
            <button
              key={b.bucket}
              type="button"
              aria-pressed={active}
              onClick={() => toggle(b.bucket)}
              className={cn(
                "cursor-pointer rounded-full border-2 px-2.5 py-1 text-xs font-black tracking-wide uppercase transition-colors",
                active ? "text-ink" : "bg-transparent",
              )}
              style={
                active
                  ? { backgroundColor: b.tone, borderColor: b.tone }
                  : { borderColor: b.tone, color: b.tone }
              }
            >
              {b.title} · {isPending ? "—" : buckets[b.bucket].length}
            </button>
          );
        })}

        {person && (
          <button
            type="button"
            aria-pressed={mine}
            onClick={() => setMine(!mine)}
            title={
              mine
                ? "Showing only what you're on"
                : "Show only the follow-ups you're on"
            }
            className={cn(
              "cursor-pointer rounded-full border-2 px-2.5 py-1 text-xs font-black tracking-wide uppercase transition-colors",
              mine ? "text-ink" : "bg-transparent",
            )}
            style={
              mine
                ? {
                    backgroundColor: person.color ?? "#888",
                    borderColor: person.color ?? "#888",
                  }
                : { borderColor: person.color ?? "#888", color: person.color ?? "#888" }
            }
          >
            Mine
          </button>
        )}
      </div>

      {/* Nothing below the chips while the counts are still dashes, and
          nothing below them at all until one is picked. */}
      {!isPending &&
        section &&
        (rows.length > 0 ? (
          <div className="grid gap-3">
            {rows.map((row) =>
              section.bucket === "vanished" ? (
                <VanishedRow key={row.id} row={row} tone={section.tone} now={now} />
              ) : (
                <QueueRow
                  key={row.id}
                  row={row}
                  bucket={section.bucket}
                  tone={section.tone}
                  today={today}
                  now={now}
                />
              ),
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {mine ? "Nothing here with your name on it." : "Nothing here."}
          </p>
        ))}
    </div>
  );
}
