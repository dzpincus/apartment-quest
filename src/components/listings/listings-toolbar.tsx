"use client";

import { useState, type ChangeEvent } from "react";
import { List, Map as MapIcon, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { PersonDot } from "@/components/person-dot";
import { usePerson } from "@/lib/person";
import { SimpleSelect, type SelectOption } from "@/components/simple-select";
import { AddListingDialogSlot } from "@/components/listings/add-listing-dialog";
import { IncomesPopover } from "@/components/listings/incomes-popover";
import {
  AC_FILTER_OPTIONS,
  DISHWASHER_FILTER_OPTIONS,
  FEE_FILTER_OPTIONS,
  LAUNDRY_FILTER_OPTIONS,
  OUTDOOR_FILTER_OPTIONS,
  PETS_FILTER_OPTIONS,
  STATUS_FILTER_OPTIONS,
} from "@/components/listings/options";
import {
  activeFilterCount,
  clearFilter,
  defaultSortDir,
  EMPTY_FILTERS,
  type Filters,
  type Sort,
  type SortKey,
} from "@/lib/listing-filters";
import { useLocations } from "@/lib/queries";
import { usePrimaryLocationId, type ListingsView } from "@/lib/prefs";
import { VOTE_LABELS, type MyVoteFilter } from "@/lib/votes";
import { rentShort } from "@/lib/format";
import { cn } from "@/lib/utils";

/** "My vote" — resolved against the person on this device, not everyone's. */
const MY_VOTE_OPTIONS: SelectOption<MyVoteFilter>[] = [
  { value: "all", label: "Any vote" },
  { value: "yes", label: `My vote: ${VOTE_LABELS.yes}` },
  { value: "maybe", label: `My vote: ${VOTE_LABELS.maybe}` },
  { value: "no", label: `My vote: ${VOTE_LABELS.no}` },
  { value: "none", label: "Not voted" },
];

/**
 * The mobile sort list. "Transit to ⭐" is appended only when this device has
 * starred a place — see `sortOptions` below.
 */
const SORT_OPTIONS: SelectOption<SortKey>[] = [
  { value: "created_at", label: "Newest" },
  { value: "rent", label: "Rent" },
  { value: "beds", label: "Beds" },
  { value: "address", label: "Address" },
  { value: "neighborhood", label: "Neighborhood" },
  { value: "status", label: "Status" },
  { value: "pets", label: "Pets" },
  { value: "amenities", label: "Amenities" },
  { value: "votes", label: "Most yes" },
  { value: "next_action_due", label: "Next action due" },
];

function sortOptions(hasPrimary: boolean): SelectOption<SortKey>[] {
  return hasPrimary
    ? [...SORT_OPTIONS, { value: "transitToPrimary", label: "Transit to ⭐" }]
    : SORT_OPTIONS;
}

/**
 * The three numeric filters, declared once and rendered twice: inline on a
 * desktop toolbar, labelled inside the phone's filter sheet.
 */
type NumberField = {
  key: "rentMin" | "rentMax" | "bedsMin";
  /** The sheet's label, and the inline control's accessible name. */
  label: string;
  placeholder: string;
  inputMode: "numeric" | "decimal";
  /** Inline width. The sheet's grid ignores it and uses the whole cell. */
  inlineClassName: string;
};

const NUMBER_FIELDS: NumberField[] = [
  {
    key: "rentMin",
    label: "Rent min",
    placeholder: "Rent min",
    inputMode: "numeric",
    inlineClassName: "w-24",
  },
  {
    key: "rentMax",
    label: "Rent max",
    placeholder: "Rent max",
    inputMode: "numeric",
    inlineClassName: "w-24",
  },
  {
    key: "bedsMin",
    label: "Beds (min)",
    placeholder: "Beds +",
    inputMode: "decimal",
    inlineClassName: "w-20",
  },
];

/**
 * The select-shaped filters, same idea. `options` is widened to
 * `SelectOption<string>` so one component can render all of them; every list
 * here comes from `options.ts`, so the values that reach `Filters` are still
 * only the ones the type allows.
 */
type SelectField = {
  key: Exclude<keyof Filters, "rentMin" | "rentMax" | "bedsMin">;
  label: string;
  options: ReadonlyArray<SelectOption<string>>;
  inlineClassName: string;
};

function selectFields(neighborhoodOptions: string[]): SelectField[] {
  return [
    {
      key: "neighborhood",
      label: "Neighborhood",
      options: [
        { value: "all", label: "Any neighborhood" },
        ...neighborhoodOptions.map((n) => ({ value: n, label: n })),
      ],
      inlineClassName: "w-40",
    },
    {
      key: "status",
      label: "Status",
      options: STATUS_FILTER_OPTIONS,
      inlineClassName: "w-36",
    },
    { key: "feeType", label: "Fee", options: FEE_FILTER_OPTIONS, inlineClassName: "w-28" },
    { key: "pets", label: "Pets", options: PETS_FILTER_OPTIONS, inlineClassName: "w-32" },
    {
      key: "laundry",
      label: "Laundry",
      options: LAUNDRY_FILTER_OPTIONS,
      inlineClassName: "w-40",
    },
    {
      key: "dishwasher",
      label: "Dishwasher",
      options: DISHWASHER_FILTER_OPTIONS,
      inlineClassName: "w-36",
    },
    { key: "ac", label: "AC", options: AC_FILTER_OPTIONS, inlineClassName: "w-32" },
    {
      key: "outdoor_space",
      label: "Outdoor space",
      options: OUTDOOR_FILTER_OPTIONS,
      inlineClassName: "w-40",
    },
    {
      key: "myVote",
      label: "My vote",
      options: MY_VOTE_OPTIONS,
      inlineClassName: "w-36",
    },
  ];
}

/** What one numeric filter hands its `<Input>`, inline and in the sheet. */
type NumberProps = {
  inputMode: "numeric" | "decimal";
  placeholder: string;
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
};

/** `$4k` when the box holds a number, and whatever was typed when it does not. */
function rentChip(raw: string, prefix: string): string {
  const n = Number(raw);
  return `${prefix} ${Number.isFinite(n) && raw.trim() !== "" ? rentShort(n) : raw}`;
}

/**
 * One chip per active filter, in toolbar order. The label is the option's own
 * label, so a chip can never disagree with the control that set it.
 */
function activeChips(
  filters: Filters,
  fields: SelectField[],
): Array<{ key: keyof Filters; label: string }> {
  const chips: Array<{ key: keyof Filters; label: string }> = [];
  if (filters.rentMin !== "") {
    chips.push({ key: "rentMin", label: rentChip(filters.rentMin, "≥") });
  }
  if (filters.rentMax !== "") {
    chips.push({ key: "rentMax", label: rentChip(filters.rentMax, "≤") });
  }
  if (filters.bedsMin !== "") {
    chips.push({ key: "bedsMin", label: `${filters.bedsMin}+ bd` });
  }
  for (const field of fields) {
    const value = filters[field.key];
    if (value === EMPTY_FILTERS[field.key]) continue;
    const label = field.options.find((o) => o.value === value)?.label ?? String(value);
    chips.push({ key: field.key, label });
  }
  return chips;
}

export function ListingsToolbar({
  filters,
  onFiltersChange,
  sort,
  onSortChange,
  neighborhoodOptions,
  count,
  view,
  onViewChange,
}: {
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
  sort: Sort;
  onSortChange: (sort: Sort) => void;
  neighborhoodOptions: string[];
  count: number;
  /** List or map. Persisted per device in `prefs.ts`, not in the URL. */
  view: ListingsView;
  onViewChange: (view: ListingsView) => void;
}) {
  const { person, people } = usePerson();
  const { data: locations } = useLocations();
  // The "Transit to ⭐" sort option follows the column, which follows the
  // starred place actually being in the loaded list — see `prefs.ts`.
  const primaryId = usePrimaryLocationId(person?.id, locations);

  const fields = selectFields(neighborhoodOptions);
  const active = activeFilterCount(filters);
  const chips = activeChips(filters, fields);

  const numberProps = (field: NumberField): NumberProps => ({
    inputMode: field.inputMode,
    placeholder: field.placeholder,
    value: filters[field.key],
    onChange: (e) => onFiltersChange({ ...filters, [field.key]: e.target.value }),
  });

  return (
    // `min-w-0` on every row below: these are flex children, and a flex child
    // defaults to min-content — which is what let a row of eleven nowrap
    // controls push the whole page wider than the phone.
    <div className="flex min-w-0 flex-col gap-2">
      {/* Wraps: the title takes the first line and the controls the second as
          soon as they stop fitting side by side. Nothing in here shrinks
          (buttons are `whitespace-nowrap`), so without the wrap this row is
          what dragged the page past the right edge of a 412px screen. */}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="text-[26px] leading-tight md:text-2xl">Listings</h1>
          <span className="text-sm text-muted-foreground tabular-nums">{count}</span>
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {/* On a phone this control lives in the filter row below, next to
              the other two things that change what you are looking at. */}
          <ViewToggle view={view} onViewChange={onViewChange} className="hidden md:inline-flex" />
          <IncomesPopover />
          {/* Slot, not the dialog itself: it reads `?import=` and so has to
              sit behind a Suspense boundary of its own. */}
          <AddListingDialogSlot />
        </div>
      </div>

      {/* The cards below are bordered by whoever found the listing; without
          this the colour is decoration nobody can decode. The desktop table
          says "By" in its own column, so the legend is mobile-only. */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-extrabold text-faint md:hidden">
        <span>Border = who found it</span>
        {people.map((p) => (
          <PersonDot key={p.id} person={p} withName className="gap-1" />
        ))}
      </div>

      {/* Phone: one row. Eleven stacked selects were the whole screen before
          anybody saw a listing, so the filters move into a sheet and only
          their count stays out here. */}
      <div className="flex min-w-0 flex-wrap items-center gap-2 md:hidden">
        <FiltersSheet
          filters={filters}
          onFiltersChange={onFiltersChange}
          fields={fields}
          numberProps={numberProps}
          active={active}
        />
        <SimpleSelect<SortKey>
          className="h-9 min-w-0 flex-1 basis-28"
          value={sort.key}
          options={sortOptions(Boolean(primaryId))}
          onValueChange={(key) => onSortChange({ key, dir: defaultSortDir(key) })}
          aria-label="Sort by"
        />
        <ViewToggle view={view} onViewChange={onViewChange} className="shrink-0" />
      </div>

      {chips.length > 0 && (
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 md:hidden">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => onFiltersChange(clearFilter(filters, chip.key))}
              aria-label={`Remove filter: ${chip.label}`}
              className="inline-flex h-7 max-w-full items-center gap-1 rounded-full border-2 border-border bg-inset px-2.5 text-[11px] font-extrabold text-muted-foreground"
            >
              <span className="min-w-0 truncate">{chip.label}</span>
              <X className="size-3 shrink-0" aria-hidden />
            </button>
          ))}
          <button
            type="button"
            onClick={() => onFiltersChange(EMPTY_FILTERS)}
            className="inline-flex h-7 items-center px-1 text-[11px] font-extrabold text-faint underline"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Desktop: the inline row, unchanged. There is room for it there. */}
      <div className="hidden min-w-0 flex-wrap items-center gap-2 md:flex">
        {NUMBER_FIELDS.map((field) => (
          <Input
            key={field.key}
            className={cn("h-8", field.inlineClassName)}
            aria-label={field.label}
            {...numberProps(field)}
          />
        ))}
        {fields.map((field) => (
          <SimpleSelect<string>
            key={field.key}
            className={field.inlineClassName}
            value={filters[field.key]}
            options={field.options}
            onValueChange={(value) =>
              onFiltersChange({ ...filters, [field.key]: value } as Filters)
            }
            aria-label={`${field.label} filter`}
          />
        ))}
        {active > 0 && (
          <Button variant="ghost" size="sm" onClick={() => onFiltersChange(EMPTY_FILTERS)}>
            <X />
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * The phone's filters: a bottom sheet, capped at 85dvh and scrolling inside,
 * with the same controls the desktop row carries. Filters apply as they are
 * picked — "Done" closes, it does not commit — so the count on the button and
 * the chips outside it are never out of date with the list behind the sheet.
 */
function FiltersSheet({
  filters,
  onFiltersChange,
  fields,
  numberProps,
  active,
}: {
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
  fields: SelectField[];
  numberProps: (field: NumberField) => NumberProps;
  active: number;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={<Button variant="outline" size="sm" className="h-9 shrink-0" />}
      >
        <SlidersHorizontal />
        Filters
        {active > 0 && (
          <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-black text-ink tabular-nums">
            {active}
          </span>
        )}
      </SheetTrigger>
      <SheetContent
        side="bottom"
        className="max-h-[85dvh] gap-0 rounded-t-[24px] border-t-2 border-border p-0"
      >
        <SheetHeader className="px-4 pt-4 pb-2">
          <SheetTitle>Filters</SheetTitle>
          <SheetDescription>
            Applied as you pick them. {active === 0 ? "None set." : `${active} set.`}
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
          <div className="grid grid-cols-2 gap-3">
            {NUMBER_FIELDS.map((field) => (
              <div key={field.key} className="grid min-w-0 gap-1.5">
                <Label
                  htmlFor={`filter-${field.key}`}
                  className="text-xs font-extrabold text-muted-foreground"
                >
                  {field.label}
                </Label>
                <Input
                  id={`filter-${field.key}`}
                  className="w-full"
                  {...numberProps(field)}
                />
              </div>
            ))}
            {fields.map((field) => (
              <div
                key={field.key}
                className={cn(
                  "grid min-w-0 gap-1.5",
                  field.key === "neighborhood" && "col-span-2",
                )}
              >
                <Label
                  htmlFor={`filter-${field.key}`}
                  className="text-xs font-extrabold text-muted-foreground"
                >
                  {field.label}
                </Label>
                <SimpleSelect<string>
                  id={`filter-${field.key}`}
                  className="w-full"
                  value={filters[field.key]}
                  options={field.options}
                  onValueChange={(value) =>
                    onFiltersChange({ ...filters, [field.key]: value } as Filters)
                  }
                />
              </div>
            ))}
          </div>
        </div>

        <SheetFooter className="flex-row items-center gap-2 border-t border-border p-3">
          <Button
            variant="ghost"
            disabled={active === 0}
            onClick={() => onFiltersChange(EMPTY_FILTERS)}
          >
            <X />
            Clear all
          </Button>
          <SheetClose render={<Button className="ml-auto" />}>Done</SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/**
 * List or map, as one segmented control. Two 44px targets rather than a select:
 * this is the switch people flip most often on a phone, and a two-option
 * dropdown costs a tap to *see* the options.
 */
function ViewToggle({
  view,
  onViewChange,
  className,
}: {
  view: ListingsView;
  onViewChange: (view: ListingsView) => void;
  className?: string;
}) {
  const options = [
    { value: "list" as const, label: "List", Icon: List },
    { value: "map" as const, label: "Map", Icon: MapIcon },
  ];
  return (
    <div
      role="group"
      aria-label="How to show the listings"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full border-2 border-border bg-card p-0.5",
        className,
      )}
    >
      {options.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          onClick={() => onViewChange(value)}
          aria-pressed={view === value}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-extrabold md:h-7 md:text-xs",
            view === value
              ? "bg-primary text-ink"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="size-4" />
          {label}
        </button>
      ))}
    </div>
  );
}
