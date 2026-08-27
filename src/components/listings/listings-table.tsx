"use client";

import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { InlineEdit, toNumberOrNull, toTextOrNull } from "@/components/inline-edit";
import { PersonDot } from "@/components/person-dot";
import { UnreadBadge } from "@/components/unread-badge";
import { QualifyBadge } from "@/components/listings/qualify-badge";
import { StatusSelect } from "@/components/listings/status-select";
import { VoteChips } from "@/components/listings/vote-chips";
import { PetsMark } from "@/components/listings/pets-mark";
import { AmenityMarks } from "@/components/listings/amenity-marks";
import { ListingThumb } from "@/components/listings/listing-thumb";
import { GoneBadge } from "@/components/listings/gone-badge";
import { useRowEdit } from "@/components/listings/use-row-edit";
import { useUnread, type ListingRow } from "@/lib/queries";
import {
  defaultSortDir,
  transitSeconds,
  type Sort,
  type SortKey,
} from "@/lib/listing-filters";
import { usePerson } from "@/lib/person";
import { usePrimaryLocationId } from "@/lib/prefs";
import { commuteMinutes } from "@/lib/geo-types";
import { money } from "@/lib/format";
import { fmtDay } from "@/lib/time";
import type { Uuid } from "@/lib/types";

const COLUMNS: { key: SortKey; label: string; className?: string }[] = [
  { key: "address", label: "Address" },
  { key: "neighborhood", label: "Neighborhood" },
  // Rent gets a floor of its own: a number that wraps or ellipsises is the one
  // thing in this table nobody can read around ("$5,2…" is not a rent).
  { key: "rent", label: "Rent", className: "min-w-[5.5rem] text-right" },
  { key: "beds", label: "Bd / Ba" },
  { key: "pets", label: "Pets" },
  { key: "amenities", label: "Amenities" },
  { key: "status", label: "Status" },
  { key: "votes", label: "Votes" },
  { key: "broker", label: "Broker" },
  { key: "next_action_due", label: "Next action" },
];

/**
 * The starred place's transit column, inserted after Votes and *only* when
 * this device has starred somewhere (0010). The table's columns are a budget:
 * a column of em dashes for a preference nobody set is the kind of thing that
 * pushes the address into an ellipsis.
 */
const TRANSIT_COLUMN: { key: SortKey; label: string; className?: string } = {
  key: "transitToPrimary",
  label: "⭐ Transit",
  className: "text-right whitespace-nowrap",
};

function columns(hasPrimary: boolean) {
  if (!hasPrimary) return COLUMNS;
  const at = COLUMNS.findIndex((col) => col.key === "votes");
  return [...COLUMNS.slice(0, at + 1), TRANSIT_COLUMN, ...COLUMNS.slice(at + 1)];
}

export function ListingsTable({
  rows,
  incomes,
  sort,
  onSortChange,
}: {
  rows: ListingRow[];
  incomes: ReadonlyArray<number | null | undefined>;
  sort: Sort;
  onSortChange: (sort: Sort) => void;
}) {
  const unread = useUnread();
  const { person } = usePerson();
  const primaryId = usePrimaryLocationId(person?.id);

  function toggle(key: SortKey) {
    onSortChange(
      sort.key === key
        ? { key, dir: sort.dir === "asc" ? "desc" : "asc" }
        : { key, dir: defaultSortDir(key) },
    );
  }

  return (
    <Table className="text-sm">
      <TableHeader>
        <TableRow>
          {columns(Boolean(primaryId)).map((col) => (
            <TableHead
              key={col.key}
              className={col.className}
              aria-sort={
                sort.key === col.key
                  ? sort.dir === "asc"
                    ? "ascending"
                    : "descending"
                  : "none"
              }
            >
              <button
                type="button"
                onClick={() => toggle(col.key)}
                className="inline-flex items-center gap-1 hover:text-foreground"
              >
                {col.label}
                {sort.key === col.key &&
                  (sort.dir === "asc" ? (
                    <ArrowUp className="size-3" />
                  ) : (
                    <ArrowDown className="size-3" />
                  ))}
              </button>
            </TableHead>
          ))}
          <TableHead>Qualify</TableHead>
          <TableHead className="text-right">By</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <Row
            key={row.id}
            row={row}
            incomes={incomes}
            unread={unread.byListing[row.id] ?? 0}
            primaryLocationId={primaryId}
          />
        ))}
      </TableBody>
    </Table>
  );
}

function Row({
  row,
  incomes,
  unread,
  primaryLocationId,
}: {
  row: ListingRow;
  incomes: ReadonlyArray<number | null | undefined>;
  unread: number;
  /** Null when nobody starred a place — then there is no column to fill. */
  primaryLocationId: Uuid | null;
}) {
  const save = useRowEdit(row);

  return (
    // 3px left rail in the colour of whoever found it — the desktop version of
    // the mobile card's border. Legend lives in the toolbar.
    <TableRow
      style={{ borderLeft: `3px solid ${row.added_by_person?.color ?? "#888"}` }}
    >
      {/* Wider since the Fee column left — the address is what anyone
          scans for, and the freed width goes to it and to Amenities. */}
      <TableCell className="max-w-72">
        <span className="flex items-center gap-2">
          {/* Small enough to sit inside the row's line height, so adding
              photos never changes the table's rhythm. */}
          <ListingThumb photo={row.photos?.[0]} alt="" className="size-10" />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <Link
                href={`/listings/${row.id}`}
                className="truncate font-medium underline-offset-4 hover:underline"
              >
                {row.address}
              </Link>
              <UnreadBadge count={unread} />
              <GoneBadge state={row.listing_state} note={row.state_note} />
            </span>
            <InlineEdit
              label="unit"
              value={row.unit}
              placeholder="+ unit"
              className="text-xs text-muted-foreground"
              inputClassName="h-6"
              onSave={(raw) => save({ unit: toTextOrNull(raw) })}
              display={row.unit ? `#${row.unit}` : undefined}
            />
          </span>
        </span>
      </TableCell>

      <TableCell className="max-w-36">
        <InlineEdit
          label="neighborhood"
          value={row.neighborhood}
          onSave={(raw) => save({ neighborhood: toTextOrNull(raw) })}
        />
      </TableCell>

      {/* No width cap and no `truncate`: `InlineEdit` bakes both into its
          button, so the overrides go through `className` (tailwind-merge drops
          `truncate` when `text-clip` follows it). A rent renders whole or the
          column gets wider — it never renders as "$5,2…". */}
      <TableCell className="min-w-[5.5rem] text-right tabular-nums whitespace-nowrap">
        <InlineEdit
          label="rent"
          type="number"
          value={row.rent}
          display={row.rent == null ? undefined : money(row.rent)}
          className="w-auto max-w-none text-right text-clip whitespace-nowrap"
          inputClassName="text-right"
          onSave={(raw) => save({ rent: toNumberOrNull(raw) })}
        />
      </TableCell>

      {/* "3 / 3" as one unbreakable phrase — two fixed-width boxes with a
          slash floating between them read as two separate facts. */}
      <TableCell className="whitespace-nowrap tabular-nums">
        <span className="inline-flex items-center gap-0.5 whitespace-nowrap">
          <InlineEdit
            label="beds"
            type="number"
            value={row.beds}
            className="w-auto max-w-none text-clip whitespace-nowrap"
            inputClassName="w-14"
            onSave={(raw) => save({ beds: toNumberOrNull(raw) })}
          />
          <span className="text-muted-foreground">/</span>
          <InlineEdit
            label="baths"
            type="number"
            value={row.baths}
            className="w-auto max-w-none text-clip whitespace-nowrap"
            inputClassName="w-14"
            onSave={(raw) => save({ baths: toNumberOrNull(raw) })}
          />
        </span>
      </TableCell>

      <TableCell>
        <PetsMark pets={row.pets} notes={row.pet_notes} />
      </TableCell>

      {/* Four columns, one cell: laundry / dishwasher / AC / outdoor space,
          with the unanswered ones left out. Sorted by `amenityRank`. */}
      <TableCell className="max-w-56">
        <AmenityMarks listing={row} className="text-xs" />
      </TableCell>

      <TableCell>
        <StatusSelect listing={row} className="w-36 border-transparent" />
      </TableCell>

      <TableCell>
        <VoteChips votes={row.votes} />
      </TableCell>

      {/* Transit to the starred place. A cached answer or an em dash — this
          cell never asks Google anything; "Refresh times" on the detail page
          is the only thing that spends. */}
      {primaryLocationId && (
        <TableCell className="text-right tabular-nums whitespace-nowrap">
          {(() => {
            const seconds = transitSeconds(row, primaryLocationId);
            return seconds == null ? (
              <span className="text-faint">—</span>
            ) : (
              commuteMinutes(seconds)
            );
          })()}
        </TableCell>
      )}

      <TableCell className="max-w-36 truncate">
        {row.broker ? (
          <Link
            href="/brokers"
            className="underline-offset-4 hover:underline"
            title={row.broker.company ?? undefined}
          >
            {row.broker.name}
          </Link>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>

      <TableCell className="max-w-40">
        {row.next_action ? (
          <span className="flex flex-col">
            <span className="truncate">{row.next_action}</span>
            {row.next_action_due && (
              <span className="text-xs text-muted-foreground">
                due {fmtDay(row.next_action_due)}
              </span>
            )}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>

      <TableCell>
        <QualifyBadge
          rent={row.rent}
          incomeMultiplier={row.income_multiplier}
          incomes={incomes}
        />
      </TableCell>

      <TableCell className="text-right">
        <PersonDot person={row.added_by_person} />
      </TableCell>
    </TableRow>
  );
}
