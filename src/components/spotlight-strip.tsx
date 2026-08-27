"use client";

/**
 * "Look at this one! 👀" — Home's spotlight strip (0012).
 *
 * Four people, at most one spotlight each, so this is at most four cards and
 * usually one or two. It sits between the unread strip and the follow-up queue:
 * what the house *said* comes before what the brokers are owed, and a thing
 * somebody deliberately promoted comes before a thing a date made urgent.
 *
 * The note is the dominant element on each card, not the address — the address
 * is on the listings page and always has been; the reason is the part that only
 * exists here. Nothing renders when nobody has spotlighted anything: a
 * permanent empty shelf on the queue screen would cost the queue a fold.
 *
 * Reads `useListings()` (the entry the queue and the nav badge already hold)
 * and `usePerson().people`. No query of its own — spotlights ride on the
 * listing row.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Image as ImageIcon } from "lucide-react";
import { PersonDot } from "@/components/person-dot";
import { useListings, sortPhotos, type ListingRow } from "@/lib/queries";
import { usePerson } from "@/lib/person";
import { photoUrl } from "@/lib/photos-client";
import { activeSpotlights } from "@/lib/spotlight";
import { bedsBaths, listingLabel, money } from "@/lib/format";
import { timeAgo } from "@/lib/time";
import type { Person } from "@/lib/types";

/** Same minute-hand as the queue: "2h ago" must not freeze on a tab left open. */
const TICK_MS = 60_000;

export function SpotlightStrip() {
  const { data: rows } = useListings();
  const { people } = usePerson();
  const spotlights = activeSpotlights(rows, people);

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  if (spotlights.length === 0) return null;

  return (
    <section aria-label="Spotlights" className="grid gap-2">
      <h2 className="text-xs font-black tracking-wide text-muted-foreground uppercase">
        Look at this one! 👀
      </h2>
      {/* One swipeable row on a phone, two columns from md. `-mx-1 px-1` gives
          the cards' focus rings somewhere to land without the scroll container
          clipping them. */}
      <div className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-1 md:grid md:grid-cols-2 md:overflow-visible">
        {spotlights.map((s) => (
          <SpotlightCard
            key={s.person.id}
            person={s.person}
            listing={s.listing}
            note={s.note}
            at={s.created_at}
            now={now}
          />
        ))}
      </div>
    </section>
  );
}

function SpotlightCard({
  person,
  listing,
  note,
  at,
  now,
}: {
  person: Person;
  listing: ListingRow;
  note: string | null;
  at: string;
  now: Date;
}) {
  const photo = sortPhotos(listing.photos)[0];
  const color = person.color ?? "#888";
  const detail =
    [listing.neighborhood, bedsBaths(listing.beds, listing.baths)]
      .filter(Boolean)
      .join(" · ") || "No details yet";

  return (
    <Link
      href={`/listings/${listing.id}`}
      // The left rail is the colour of whoever is shouting — the same device
      // the table's rail and the cards' border use, always from `people.color`
      // and never from a literal.
      className="grid min-w-[85%] shrink-0 snap-start content-start gap-2 rounded-[20px] border-2 border-l-[3px] border-border bg-card p-3.5 hover:bg-surface-hover md:min-w-0"
      style={{ borderLeftColor: color }}
    >
      <div className="flex min-w-0 items-start gap-3">
        {/* Same fallback tile the table uses, so a listing with no photos does
            not make the row start in a different place. */}
        <span className="size-14 shrink-0 overflow-hidden rounded-2xl border-2 border-border bg-inset">
          {photo ? (
            /* Public bucket thumbnail, already 400px webp — no optimiser. */
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={photoUrl(photo.thumb_path)}
              alt=""
              loading="lazy"
              draggable={false}
              className="size-full object-cover"
            />
          ) : (
            <span className="grid size-full place-items-center" aria-hidden="true">
              <ImageIcon className="size-5 text-faint" />
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-black">
            {listingLabel(listing.address, listing.unit)}
          </span>
          <span className="block truncate text-xs text-muted-foreground">{detail}</span>
        </span>
        <span
          className="shrink-0 text-[17px] font-black whitespace-nowrap tabular-nums"
          style={{ color }}
        >
          {money(listing.rent) || "—"}
        </span>
      </div>

      {/* The reason, and the biggest thing on the card. A spotlight with
          nothing typed under it is still a spotlight — it just prints no quote
          block rather than an empty one. */}
      {note && (
        <p className="text-[17px] leading-snug font-black break-words text-foreground">
          “{note}”
        </p>
      )}

      <p className="flex min-w-0 items-center gap-1.5 text-xs font-extrabold text-muted-foreground">
        <PersonDot person={person} withName colorName />
        <span className="shrink-0 text-faint">· {timeAgo(at, now)}</span>
      </p>
    </Link>
  );
}
