/** Pure filter + sort for the listings table. No React. */

import type { ListingRow } from "@/lib/queries";
import type { FeeType, ListingStatus } from "@/lib/types";

export type Filters = {
  rentMin: string;
  rentMax: string;
  bedsMin: string;
  neighborhood: string;
  status: ListingStatus | "all";
  feeType: FeeType | "all";
};

export const EMPTY_FILTERS: Filters = {
  rentMin: "",
  rentMax: "",
  bedsMin: "",
  neighborhood: "all",
  status: "all",
  feeType: "all",
};

export function hasActiveFilters(f: Filters): boolean {
  return (
    f.rentMin !== "" ||
    f.rentMax !== "" ||
    f.bedsMin !== "" ||
    f.neighborhood !== "all" ||
    f.status !== "all" ||
    f.feeType !== "all"
  );
}

export type SortKey =
  | "address"
  | "neighborhood"
  | "rent"
  | "beds"
  | "fee_type"
  | "status"
  | "broker"
  | "next_action_due"
  | "created_at";

export type Sort = { key: SortKey; dir: "asc" | "desc" };

function num(raw: string): number | null {
  const n = Number(raw);
  return raw.trim() === "" || Number.isNaN(n) ? null : n;
}

export function applyFilters(rows: ListingRow[], f: Filters): ListingRow[] {
  const rentMin = num(f.rentMin);
  const rentMax = num(f.rentMax);
  const bedsMin = num(f.bedsMin);
  return rows.filter((r) => {
    if (rentMin != null && (r.rent ?? 0) < rentMin) return false;
    if (rentMax != null && (r.rent ?? Number.POSITIVE_INFINITY) > rentMax) return false;
    if (bedsMin != null && (r.beds ?? 0) < bedsMin) return false;
    if (f.neighborhood !== "all" && (r.neighborhood ?? "") !== f.neighborhood) return false;
    if (f.status !== "all" && r.status !== f.status) return false;
    if (f.feeType !== "all" && (r.fee_type ?? "unknown") !== f.feeType) return false;
    return true;
  });
}

function sortValue(row: ListingRow, key: SortKey): string | number | null {
  switch (key) {
    case "address":
      return `${row.address ?? ""} ${row.unit ?? ""}`.toLowerCase();
    case "broker":
      return row.broker?.name?.toLowerCase() ?? null;
    case "neighborhood":
      return row.neighborhood?.toLowerCase() ?? null;
    case "fee_type":
      return row.fee_type ?? null;
    case "status":
      return row.status ?? null;
    case "next_action_due":
      return row.next_action_due ?? null;
    case "created_at":
      return row.created_at ?? null;
    default:
      return row[key] ?? null;
  }
}

/** Blanks always sink to the bottom, whichever direction is active. */
export function sortRows(rows: ListingRow[], sort: Sort): ListingRow[] {
  const factor = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = sortValue(a, sort.key);
    const vb = sortValue(b, sort.key);
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * factor;
    return String(va).localeCompare(String(vb)) * factor;
  });
}

export function neighborhoods(rows: ListingRow[]): string[] {
  return [...new Set(rows.map((r) => r.neighborhood).filter((n): n is string => !!n))].sort(
    (a, b) => a.localeCompare(b),
  );
}
