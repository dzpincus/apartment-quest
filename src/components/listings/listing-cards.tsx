"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PersonDot } from "@/components/person-dot";
import { UnreadBadge } from "@/components/unread-badge";
import { QualifyBadge } from "@/components/listings/qualify-badge";
import { StatusSelect } from "@/components/listings/status-select";
import { VoteChips } from "@/components/listings/vote-chips";
import { PetsMark } from "@/components/listings/pets-mark";
import { useUnread, type ListingRow } from "@/lib/queries";
import { FEE_TYPE_LABELS, bedsBaths, listingLabel, money } from "@/lib/format";

/** Under `md`: one tappable card per listing, status editable in place. */
export function ListingCards({
  rows,
  incomes,
}: {
  rows: ListingRow[];
  incomes: ReadonlyArray<number | null | undefined>;
}) {
  const unread = useUnread();

  return (
    <div className="grid gap-2">
      {rows.map((row) => (
        <Card key={row.id} className="gap-2 p-3">
          <Link href={`/listings/${row.id}`} className="flex items-start justify-between gap-2">
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 font-medium">
                <span className="truncate">{listingLabel(row.address, row.unit)}</span>
                <UnreadBadge count={unread.byListing[row.id] ?? 0} />
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                {[row.neighborhood, bedsBaths(row.beds, row.baths), row.trains]
                  .filter(Boolean)
                  .join(" · ") || "No details yet"}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1 text-right">
              <span className="font-medium tabular-nums">{money(row.rent) || "—"}</span>
              <ChevronRight className="size-4 text-muted-foreground" />
            </span>
          </Link>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <StatusSelect listing={row} className="w-36" />
            <VoteChips votes={row.votes} />
            <QualifyBadge
              rent={row.rent}
              incomeMultiplier={row.income_multiplier}
              incomes={incomes}
            />
          </div>

          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="flex min-w-0 items-center gap-1.5">
              <PetsMark pets={row.pets} notes={row.pet_notes} />
              <span className="truncate">
                {FEE_TYPE_LABELS[row.fee_type ?? "unknown"]}
                {row.broker ? ` · ${row.broker.name}` : ""}
              </span>
            </span>
            <PersonDot person={row.added_by_person} withName />
          </div>
        </Card>
      ))}
    </div>
  );
}
