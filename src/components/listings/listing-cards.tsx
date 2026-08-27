"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { PersonDot } from "@/components/person-dot";
import { UnreadBadge } from "@/components/unread-badge";
import { QualifyBadge } from "@/components/listings/qualify-badge";
import { StatusSelect } from "@/components/listings/status-select";
import { VoteChips } from "@/components/listings/vote-chips";
import { PetsMark } from "@/components/listings/pets-mark";
import { AmenityMarks, amenityMarks } from "@/components/listings/amenity-marks";
import { ListingThumb } from "@/components/listings/listing-thumb";
import { GoneBadge } from "@/components/listings/gone-badge";
import { useUnread, type ListingRow } from "@/lib/queries";
import { usePerson } from "@/lib/person";
import { usePrimaryLocationId } from "@/lib/prefs";
import { transitSeconds } from "@/lib/listing-filters";
import { commuteMinutes } from "@/lib/geo-types";
import { FEE_TYPE_LABELS, bedsBaths, listingLabel, money } from "@/lib/format";

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
  // Only drawn when this device starred a place — see `prefs.ts`.
  const primaryId = usePrimaryLocationId(person?.id);

  return (
    <div className="grid gap-3">
      {rows.map((row) => {
        const color = row.added_by_person?.color ?? "#888";
        const transit = transitSeconds(row, primaryId);
        return (
          <div
            key={row.id}
            className="grid gap-2.5 rounded-[20px] border-2 bg-card p-3.5 shadow-[0_6px_0_rgba(0,0,0,0.25)]"
            style={{ borderColor: color }}
          >
            <Link
              href={`/listings/${row.id}`}
              className="flex items-start justify-between gap-2"
            >
              <ListingThumb
                photo={row.photos?.[0]}
                alt=""
                className="size-16 self-center"
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-[17px] font-black">
                  <span className="truncate">{listingLabel(row.address, row.unit)}</span>
                  <UnreadBadge count={unread.byListing[row.id] ?? 0} />
                  <GoneBadge state={row.listing_state} note={row.state_note} />
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {[row.neighborhood, bedsBaths(row.beds, row.baths), row.trains]
                    .filter(Boolean)
                    .join(" · ") || "No details yet"}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1 text-right">
                <span className="text-[18px] font-black tabular-nums" style={{ color }}>
                  {money(row.rent) || "—"}
                </span>
                <ChevronRight className="size-4 text-faint" />
              </span>
            </Link>

            <div className="flex flex-wrap items-center gap-2">
              <StatusSelect listing={row} className="w-36" />
              <QualifyBadge
                rent={row.rent}
                incomeMultiplier={row.income_multiplier}
                incomes={incomes}
              />
            </div>

            <div className="flex items-center justify-between gap-2">
              <VoteChips votes={row.votes} />
              <PersonDot
                person={row.added_by_person}
                withName
                className="text-xs font-extrabold text-muted-foreground"
              />
            </div>

            {/* Amenities as their own chips: on a phone this is the line that
                decides whether the listing is worth opening. */}
            <div className="flex flex-wrap items-center gap-1.5">
              {amenityMarks(row).length > 0 && <AmenityMarks listing={row} variant="chips" />}
              {/* Transit to the starred place: a cached number, never a
                  request. Absent rather than an em dash — a phone card should
                  not carry a blank. */}
              {transit != null && (
                <span
                  className="inline-flex h-6 items-center rounded-full bg-inset px-2 text-[11px] font-black text-muted-foreground tabular-nums"
                  title="Transit to your starred place"
                >
                  ⭐ {commuteMinutes(transit)}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <PetsMark pets={row.pets} notes={row.pet_notes} />
              <span className="truncate">
                {FEE_TYPE_LABELS[row.fee_type ?? "unknown"]}
                {row.broker ? ` · ${row.broker.name}` : ""}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
