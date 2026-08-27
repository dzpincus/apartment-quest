"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { ListingsToolbar } from "@/components/listings/listings-toolbar";
import { ListingsTable } from "@/components/listings/listings-table";
import { ListingCards } from "@/components/listings/listing-cards";
import { Skeleton } from "@/components/ui/skeleton";
import { useListings } from "@/lib/queries";
import { usePerson } from "@/lib/person";
import { humans } from "@/lib/people";
import { useListingsView, usePrimaryLocationId } from "@/lib/prefs";
import {
  applyFilters,
  EMPTY_FILTERS,
  neighborhoods,
  sortRows,
  type Filters,
  type Sort,
} from "@/lib/listing-filters";

/**
 * The map — and `maplibre-gl` with it, a quarter of a megabyte — is fetched
 * the first time somebody flips to it and never on the list view. `ssr: false`
 * because MapLibre wants a real canvas; the skeleton is what the toggle
 * animates into.
 */
const MapPanel = dynamic(() => import("@/components/map/map-panel").then((m) => m.MapPanel), {
  ssr: false,
  loading: () => <Skeleton className="h-[60dvh] w-full rounded-[20px]" />,
});

export default function ListingsPage() {
  const { person, people } = usePerson();
  const { data: listings = [], isPending, error } = useListings();
  const [view, setView] = useListingsView();
  // The starred place is a device preference; only the transit column reads it.
  const primaryLocationId = usePrimaryLocationId(person?.id);

  // Filters are ephemeral view state — no need to survive a reload.
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<Sort>({ key: "created_at", dir: "desc" });

  // The qualification column sums housemates. Quest Bot (0006) is a person row
  // with an income of 0 and no business in this sum; `usePerson()` filters it
  // already, and `humans()` here means that can never quietly stop being true.
  const incomes = useMemo(() => humans(people).map((p) => p.annual_income), [people]);
  const hoods = useMemo(() => neighborhoods(listings), [listings]);
  // `person?.id` only matters to the "my vote" filter; everything else ignores it.
  const rows = useMemo(
    () =>
      sortRows(
        applyFilters(listings, filters, person?.id ?? null),
        sort,
        primaryLocationId,
      ),
    [listings, filters, sort, person?.id, primaryLocationId],
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
        view={view}
        onViewChange={setView}
      />

      {error && (
        <p className="text-sm text-destructive">
          Could not load listings: {String((error as Error).message)}
        </p>
      )}

      {isPending ? (
        <div className="grid gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-[20px]" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-2xl border-2 border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {listings.length === 0
            ? "Nothing here yet. Add the first listing."
            : "No listings match these filters."}
        </p>
      ) : view === "map" ? (
        // The same `rows` the table would have drawn — filtered, sorted and
        // already in memory. The map never filters.
        <MapPanel rows={rows} />
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
