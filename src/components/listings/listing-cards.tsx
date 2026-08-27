"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { PersonDot } from "@/components/person-dot";
import { UnreadBadge } from "@/components/unread-badge";
import { QualifyBadge } from "@/components/listings/qualify-badge";
import { StatusSelect } from "@/components/listings/status-select";
import { VoteChips } from "@/components/listings/vote-chips";
import { AmenityMarks, amenityMarks } from "@/components/listings/amenity-marks";
import { PhotoCarousel } from "@/components/listings/photo-carousel";
import { PhotoLightbox } from "@/components/listings/photo-lightbox";
import { GoneBadge } from "@/components/listings/gone-badge";
import { PoweredByGoogle } from "@/components/listings/powered-by-google";
import { useLocations, useUnread, type ListingRow } from "@/lib/queries";
import { usePerson } from "@/lib/person";
import { usePrimaryLocationId } from "@/lib/prefs";
import { transitSeconds } from "@/lib/listing-filters";
import { commuteMinutes } from "@/lib/geo-types";
import {
  FEE_TYPE_LABELS,
  PETS_LABELS,
  PETS_MARKS,
  bedsBaths,
  listingLabel,
  money,
} from "@/lib/format";
import { cn } from "@/lib/utils";

/** The card's chip: pets, amenities and the transit minutes all wear it. */
const CHIP =
  "inline-flex max-w-full items-center rounded-full bg-inset px-2 py-0.5 text-[11px] font-extrabold whitespace-nowrap text-muted-foreground";

/**
 * Under `md`: one tappable card per listing, status editable in place.
 *
 * The border — and the rent, which is the other thing anyone looks at — is the
 * colour of whoever found the listing, so a scroll through the list reads as
 * "who has been busy". The toolbar carries the legend for it.
 */
export function ListingCards({
  rows,
  incomes,
}: {
  rows: ListingRow[];
  incomes: ReadonlyArray<number | null | undefined>;
}) {
  const unread = useUnread();
  const { person } = usePerson();
  const { data: locations } = useLocations();
  // Only drawn when this device starred a place that still exists — `prefs.ts`.
  const primaryId = usePrimaryLocationId(person?.id, locations);
  // One lightbox for the whole list, not one per card: sixty dialogs mounted
  // to show at most one is sixty subscriptions to the escape key.
  const [lightbox, setLightbox] = useState<{ id: string; index: number } | null>(null);
  const open = lightbox ? rows.find((row) => row.id === lightbox.id) : undefined;

  return (
    <div className="grid gap-3">
      {rows.map((row) => {
        const color = row.added_by_person?.color ?? "#888";
        const transit = transitSeconds(row, primaryId);
        // Null is the pre-0005 shape of the same "nobody asked yet" the
        // `unknown` default means; either way the chip stays off the card
        // rather than printing a word that says nothing.
        const pets = row.pets ?? "unknown";
        const feeType = row.fee_type ?? "unknown";
        const hasChips = pets !== "unknown" || amenityMarks(row).length > 0 || transit != null;
        // Same rule for the footer: an unanswered fee reads as a blank, not as
        // "Unknown", and with no broker either the line does not draw at all.
        const footer = [feeType === "unknown" ? null : FEE_TYPE_LABELS[feeType], row.broker?.name]
          .filter(Boolean)
          .join(" · ");
        return (
          <div
            key={row.id}
            className="grid min-w-0 gap-2.5 overflow-hidden rounded-[20px] border-2 bg-card p-3.5 shadow-[0_6px_0_rgba(0,0,0,0.25)]"
            style={{ borderColor: color }}
          >
            {/* Outside the <Link>, for the same reason the gone badge is: it
                owns pointer gestures and opens a dialog, and neither survives
                being wrapped in an anchor. The card's whole width, above the
                title — the arrows sit inside the picture, so they can never
                land on the address underneath it. */}
            <PhotoCarousel
              photos={row.photos ?? []}
              alt={listingLabel(row.address, row.unit)}
              onOpen={(index) => setLightbox({ id: row.id, index })}
            />

            {/* The address is the one thing that may wrap: "913 Saint John's
                Place #1R" is wider than the space left on a 412px phone once
                the rent is paid for, and half an address is worse than two
                lines of one. Everything to its right is `shrink-0` so the rent
                can never be shaved to "$4,35". */}
            <Link
              href={`/listings/${row.id}`}
              className="flex min-w-0 items-start gap-3"
            >
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-start gap-1.5 text-[17px] font-black">
                  <span className="min-w-0 line-clamp-2 break-words">
                    {listingLabel(row.address, row.unit)}
                  </span>
                  <UnreadBadge
                    count={unread.byListing[row.id] ?? 0}
                    className="mt-0.5 shrink-0"
                  />
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {[row.neighborhood, bedsBaths(row.beds, row.baths), row.trains]
                    .filter(Boolean)
                    .join(" · ") || "No details yet"}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1 text-right">
                <span
                  className="shrink-0 text-[18px] font-black whitespace-nowrap tabular-nums"
                  style={{ color }}
                >
                  {money(row.rent) || "—"}
                </span>
                <ChevronRight className="size-4 shrink-0 text-faint" />
              </span>
            </Link>

            <div className="flex flex-wrap items-center gap-2">
              <StatusSelect listing={row} className="w-36" />
              <QualifyBadge
                rent={row.rent}
                incomeMultiplier={row.income_multiplier}
                incomes={incomes}
              />
              {/* Out of the <Link> above and down here on purpose: the badge is
                  a popover trigger now, and a button inside an anchor is both
                  invalid markup and a tap that navigates instead of opening. */}
              <GoneBadge state={row.listing_state} note={row.state_note} listing={row} />
            </div>

            {/* Wraps rather than overflows: four vote circles plus a long
                name is wider than a 412px phone once the padding is paid, and
                the name is the half that must stay readable. */}
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <VoteChips votes={row.votes} className="shrink-0" />
              <PersonDot
                person={row.added_by_person}
                withName
                className="shrink-0 text-xs font-extrabold text-muted-foreground"
              />
            </div>

            {/* Pets and amenities as their own chips: on a phone this is the
                line that decides whether the listing is worth opening. */}
            {hasChips && (
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                {pets !== "unknown" && (
                  <span
                    className={CHIP}
                    title={
                      row.pet_notes
                        ? `${PETS_LABELS[pets]} — ${row.pet_notes}`
                        : PETS_LABELS[pets]
                    }
                  >
                    {PETS_MARKS[pets]}
                  </span>
                )}
                {amenityMarks(row).length > 0 && (
                  <AmenityMarks listing={row} variant="chips" />
                )}
                {/* Transit to the starred place: a cached number, never a
                    request. Absent rather than an em dash — a phone card should
                    not carry a blank. */}
                {transit != null && (
                  <span className={cn(CHIP, "tabular-nums")} title="Transit to your starred place">
                    ⭐ {commuteMinutes(transit)}
                  </span>
                )}
              </div>
            )}

            {footer && (
              <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                <span className="truncate">{footer}</span>
              </div>
            )}
          </div>
        );
      })}
      {/* The ⭐ chips above are Routes results shown away from a Google map,
          which Google's terms allow only with this credit. It comes and goes
          with the starred place, exactly like the chips do. */}
      {primaryId && <PoweredByGoogle className="text-center" />}

      {/* Tapping a card's picture opens the same viewer the detail page uses —
          arrow keys, swipe and a counter, already written. The carousel has
          prefetched the set by the time a tap can happen, so it opens on a
          cached image rather than on a grey box. */}
      {open && (
        <PhotoLightbox
          photos={open.photos ?? []}
          index={lightbox?.index ?? null}
          label={listingLabel(open.address, open.unit)}
          onIndexChange={(index) => setLightbox((was) => (was ? { ...was, index } : was))}
          onOpenChange={(next) => !next && setLightbox(null)}
        />
      )}
    </div>
  );
}
