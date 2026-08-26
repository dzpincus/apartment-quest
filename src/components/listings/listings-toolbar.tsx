"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PersonDot } from "@/components/person-dot";
import { usePerson } from "@/lib/person";
import { Input } from "@/components/ui/input";
import { SimpleSelect, type SelectOption } from "@/components/simple-select";
import { AddListingDialogSlot } from "@/components/listings/add-listing-dialog";
import { IncomesPopover } from "@/components/listings/incomes-popover";
import {
  FEE_FILTER_OPTIONS,
  PETS_FILTER_OPTIONS,
  STATUS_FILTER_OPTIONS,
} from "@/components/listings/options";
import {
  defaultSortDir,
  EMPTY_FILTERS,
  hasActiveFilters,
  type Filters,
  type Sort,
  type SortKey,
} from "@/lib/listing-filters";
import { VOTE_LABELS, type MyVoteFilter } from "@/lib/votes";
import type { FeeType, ListingStatus, PetsPolicy } from "@/lib/types";

/** "My vote" — resolved against the person on this device, not everyone's. */
const MY_VOTE_OPTIONS: SelectOption<MyVoteFilter>[] = [
  { value: "all", label: "Any vote" },
  { value: "yes", label: `My vote: ${VOTE_LABELS.yes}` },
  { value: "maybe", label: `My vote: ${VOTE_LABELS.maybe}` },
  { value: "no", label: `My vote: ${VOTE_LABELS.no}` },
  { value: "none", label: "Not voted" },
];

const SORT_OPTIONS: SelectOption<SortKey>[] = [
  { value: "created_at", label: "Newest" },
  { value: "rent", label: "Rent" },
  { value: "beds", label: "Beds" },
  { value: "address", label: "Address" },
  { value: "neighborhood", label: "Neighborhood" },
  { value: "status", label: "Status" },
  { value: "pets", label: "Pets" },
  { value: "votes", label: "Most yes" },
  { value: "next_action_due", label: "Next action due" },
];

export function ListingsToolbar({
  filters,
  onFiltersChange,
  sort,
  onSortChange,
  neighborhoodOptions,
  count,
}: {
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
  sort: Sort;
  onSortChange: (sort: Sort) => void;
  neighborhoodOptions: string[];
  count: number;
}) {
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    onFiltersChange({ ...filters, [key]: value });

  const { people } = usePerson();

  const hoods: SelectOption[] = [
    { value: "all", label: "Any neighborhood" },
    ...neighborhoodOptions.map((n) => ({ value: n, label: n })),
  ];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h1 className="text-[26px] leading-tight md:text-2xl">Listings</h1>
        <span className="text-sm text-muted-foreground tabular-nums">{count}</span>
        <div className="ml-auto flex items-center gap-2">
          <IncomesPopover />
          {/* Slot, not the dialog itself: it reads `?import=` and so has to
              sit behind a Suspense boundary of its own. */}
          <AddListingDialogSlot />
        </div>
      </div>

      {/* The cards below are bordered by whoever found the listing; without
          this the colour is decoration nobody can decode. The desktop table
          says "By" in its own column, so the legend is mobile-only. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-extrabold text-faint md:hidden">
        <span>Border = who found it</span>
        {people.map((p) => (
          <PersonDot key={p.id} person={p} withName className="gap-1" />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="h-8 w-24"
          inputMode="numeric"
          placeholder="Rent min"
          value={filters.rentMin}
          onChange={(e) => set("rentMin", e.target.value)}
        />
        <Input
          className="h-8 w-24"
          inputMode="numeric"
          placeholder="Rent max"
          value={filters.rentMax}
          onChange={(e) => set("rentMax", e.target.value)}
        />
        <Input
          className="h-8 w-20"
          inputMode="decimal"
          placeholder="Beds +"
          value={filters.bedsMin}
          onChange={(e) => set("bedsMin", e.target.value)}
        />
        <SimpleSelect
          className="w-40"
          value={filters.neighborhood}
          options={hoods}
          onValueChange={(v) => set("neighborhood", v)}
          aria-label="Neighborhood filter"
        />
        <SimpleSelect<ListingStatus | "all">
          className="w-36"
          value={filters.status}
          options={STATUS_FILTER_OPTIONS}
          onValueChange={(v) => set("status", v)}
          aria-label="Status filter"
        />
        <SimpleSelect<FeeType | "all">
          className="w-28"
          value={filters.feeType}
          options={FEE_FILTER_OPTIONS}
          onValueChange={(v) => set("feeType", v)}
          aria-label="Fee filter"
        />
        <SimpleSelect<PetsPolicy | "all">
          className="w-32"
          value={filters.pets}
          options={PETS_FILTER_OPTIONS}
          onValueChange={(v) => set("pets", v)}
          aria-label="Pets filter"
        />
        <SimpleSelect<MyVoteFilter>
          className="w-36"
          value={filters.myVote}
          options={MY_VOTE_OPTIONS}
          onValueChange={(v) => set("myVote", v)}
          aria-label="My vote filter"
        />
        <SimpleSelect<SortKey>
          className="w-40 md:hidden"
          value={sort.key}
          options={SORT_OPTIONS}
          onValueChange={(key) => onSortChange({ key, dir: defaultSortDir(key) })}
          aria-label="Sort by"
        />
        {hasActiveFilters(filters) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onFiltersChange(EMPTY_FILTERS)}
          >
            <X />
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}
