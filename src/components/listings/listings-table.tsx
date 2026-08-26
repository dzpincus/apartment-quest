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
import { SimpleSelect } from "@/components/simple-select";
import { PersonDot } from "@/components/person-dot";
import { UnreadBadge } from "@/components/unread-badge";
import { QualifyBadge } from "@/components/listings/qualify-badge";
import { StatusSelect } from "@/components/listings/status-select";
import { VoteChips } from "@/components/listings/vote-chips";
import { FEE_OPTIONS } from "@/components/listings/options";
import { PetsMark } from "@/components/listings/pets-mark";
import { ListingThumb } from "@/components/listings/listing-thumb";
import { GoneBadge } from "@/components/listings/gone-badge";
import { useRowEdit } from "@/components/listings/use-row-edit";
import { useUnread, type ListingRow } from "@/lib/queries";
import { defaultSortDir, type Sort, type SortKey } from "@/lib/listing-filters";
import { money } from "@/lib/format";
import { fmtDay } from "@/lib/time";
import type { FeeType } from "@/lib/types";

const COLUMNS: { key: SortKey; label: string; className?: string }[] = [
  { key: "address", label: "Address" },
  { key: "neighborhood", label: "Neighborhood" },
  { key: "rent", label: "Rent", className: "text-right" },
  { key: "beds", label: "Bd / Ba" },
  { key: "fee_type", label: "Fee" },
  { key: "pets", label: "Pets" },
  { key: "status", label: "Status" },
  { key: "votes", label: "Votes" },
  { key: "broker", label: "Broker" },
  { key: "next_action_due", label: "Next action" },
];

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
          {COLUMNS.map((col) => (
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
}: {
  row: ListingRow;
  incomes: ReadonlyArray<number | null | undefined>;
  unread: number;
}) {
  const save = useRowEdit(row);

  return (
    // 3px left rail in the colour of whoever found it — the desktop version of
    // the mobile card's border. Legend lives in the toolbar.
    <TableRow
      style={{ borderLeft: `3px solid ${row.added_by_person?.color ?? "#888"}` }}
    >
      <TableCell className="max-w-56">
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

      <TableCell className="text-right tabular-nums">
        <InlineEdit
          label="rent"
          type="number"
          value={row.rent}
          display={row.rent == null ? undefined : money(row.rent)}
          className="text-right"
          inputClassName="text-right"
          onSave={(raw) => save({ rent: toNumberOrNull(raw) })}
        />
      </TableCell>

      <TableCell className="whitespace-nowrap">
        <span className="flex items-center gap-1">
          <InlineEdit
            label="beds"
            type="number"
            value={row.beds}
            className="w-10"
            inputClassName="w-14"
            onSave={(raw) => save({ beds: toNumberOrNull(raw) })}
          />
          <span className="text-muted-foreground">/</span>
          <InlineEdit
            label="baths"
            type="number"
            value={row.baths}
            className="w-10"
            inputClassName="w-14"
            onSave={(raw) => save({ baths: toNumberOrNull(raw) })}
          />
        </span>
      </TableCell>

      <TableCell>
        <SimpleSelect<FeeType>
          size="sm"
          aria-label="Fee type"
          className="w-28 border-transparent"
          value={row.fee_type ?? "unknown"}
          options={FEE_OPTIONS}
          onValueChange={(fee_type) => save({ fee_type })}
        />
      </TableCell>

      <TableCell>
        <PetsMark pets={row.pets} notes={row.pet_notes} />
      </TableCell>

      <TableCell>
        <StatusSelect listing={row} className="w-36 border-transparent" />
      </TableCell>

      <TableCell>
        <VoteChips votes={row.votes} />
      </TableCell>

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
