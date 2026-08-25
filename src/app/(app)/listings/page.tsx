"use client";

import { useMemo, useState } from "react";
import { ListingsToolbar } from "@/components/listings/listings-toolbar";
import { ListingsTable } from "@/components/listings/listings-table";
import { ListingCards } from "@/components/listings/listing-cards";
import { Skeleton } from "@/components/ui/skeleton";
import { useListings } from "@/lib/queries";
import { usePerson } from "@/lib/person";
import {
  applyFilters,
  EMPTY_FILTERS,
  neighborhoods,
  sortRows,
  type Filters,
  type Sort,
} from "@/lib/listing-filters";

export default function ListingsPage() {
  const { person, people } = usePerson();
  const { data: listings = [], isPending, error } = useListings();

  // Filters are ephemeral view state — no need to survive a reload.
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<Sort>({ key: "created_at", dir: "desc" });

  const incomes = useMemo(() => people.map((p) => p.annual_income), [people]);
  const hoods = useMemo(() => neighborhoods(listings), [listings]);
  // `person?.id` only matters to the "my vote" filter; everything else ignores it.
  const rows = useMemo(
    () => sortRows(applyFilters(listings, filters, person?.id ?? null), sort),
    [listings, filters, sort, person?.id],
  );

  return (
    <div className="space-y-4">
      <ListingsToolbar
        filters={filters}
        onFiltersChange={setFilters}
        sort={sort}
        onSortChange={setSort}
        neighborhoodOptions={hoods}
        count={rows.length}
      />

      {error && (
        <p className="text-sm text-destructive">
          Could not load listings: {String((error as Error).message)}
        </p>
      )}

      {isPending ? (
        <div className="grid gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {listings.length === 0
            ? "Nothing here yet. Add the first listing."
            : "No listings match these filters."}
        </p>
      ) : (
        <>
          <div className="hidden md:block">
            <ListingsTable
              rows={rows}
              incomes={incomes}
              sort={sort}
              onSortChange={setSort}
            />
          </div>
          <div className="md:hidden">
            <ListingCards rows={rows} incomes={incomes} />
          </div>
        </>
      )}
    </div>
  );
}
