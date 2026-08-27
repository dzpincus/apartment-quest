/** Pure filter + sort for the listings table. No React. */

import { matchesMyVote, voteScore, type MyVoteFilter } from "@/lib/votes";
import type { ListingRow } from "@/lib/queries";
import type {
  AcPolicy,
  DishwasherPolicy,
  FeeType,
  LaundryPolicy,
  ListingStatus,
  OutdoorSpacePolicy,
  PetsPolicy,
  Uuid,
} from "@/lib/types";

export type Filters = {
  rentMin: string;
  rentMax: string;
  bedsMin: string;
  neighborhood: string;
  status: ListingStatus | "all";
  feeType: FeeType | "all";
  /** A null column reads as `unknown`, same as the select does. */
  pets: PetsPolicy | "all";
  /** Amenities (0009). Same shape as `pets`: "all" is the any-answer default. */
  laundry: LaundryPolicy | "all";
  dishwasher: DishwasherPolicy | "all";
  ac: AcPolicy | "all";
  outdoor_space: OutdoorSpacePolicy | "all";
  /** "How did *I* vote" — resolved against the person on this device. */
  myVote: MyVoteFilter;
};

export const EMPTY_FILTERS: Filters = {
  rentMin: "",
  rentMax: "",
  bedsMin: "",
  neighborhood: "all",
  status: "all",
  feeType: "all",
  pets: "all",
  laundry: "all",
  dishwasher: "all",
  ac: "all",
  outdoor_space: "all",
  myVote: "all",
};

export function hasActiveFilters(f: Filters): boolean {
  return (
    f.rentMin !== "" ||
    f.rentMax !== "" ||
    f.bedsMin !== "" ||
    f.neighborhood !== "all" ||
    f.status !== "all" ||
    f.feeType !== "all" ||
    f.pets !== "all" ||
    f.laundry !== "all" ||
    f.dishwasher !== "all" ||
    f.ac !== "all" ||
    f.outdoor_space !== "all" ||
    f.myVote !== "all"
  );
}

export type SortKey =
  | "address"
  | "neighborhood"
  | "rent"
  | "beds"
  | "pets"
  | "amenities"
  | "status"
  | "broker"
  | "votes"
  | "next_action_due"
  /**
   * Transit minutes to *this device's* starred place (0010). Only offered when
   * somebody has starred one — the column is hidden otherwise, and sorting by
   * a column nobody can see is a table that reorders itself for no reason.
   */
  | "transitToPrimary"
  | "created_at";

export type Sort = { key: SortKey; dir: "asc" | "desc" };

/** Most permissive first — see the `pets` case in `sortValue`. */
const PETS_RANK: Record<PetsPolicy, number> = {
  yes: 0,
  cats_only: 1,
  dogs_only: 2,
  no: 3,
  unknown: 4,
};

/**
 * Amenity ranks (0009), best-first in every case: `in_unit` beats
 * `in_building` beats `none` beats `unknown`, and an unanswered question
 * always sorts last rather than in the middle.
 */
const LAUNDRY_RANK: Record<LaundryPolicy, number> = {
  in_unit: 0,
  in_building: 1,
  none: 2,
  unknown: 3,
};

const DISHWASHER_RANK: Record<DishwasherPolicy, number> = {
  yes: 0,
  no: 1,
  unknown: 2,
};

const AC_RANK: Record<AcPolicy, number> = {
  central: 0,
  window: 1,
  none: 2,
  unknown: 3,
};

const OUTDOOR_RANK: Record<OutdoorSpacePolicy, number> = {
  private: 0,
  shared: 1,
  none: 2,
  unknown: 3,
};

/**
 * One number for the table's single "Amenities" column, lowest = best.
 *
 * The four ranks are packed lexicographically rather than added up, so the
 * column has a defined tie-break instead of letting a dishwasher outvote
 * in-unit laundry: laundry decides the order, then AC, then outdoor space,
 * then the dishwasher. Nulls read as `unknown`, so a pre-0009 row sorts with
 * the ones nobody has asked about.
 */
export function amenityRank(row: {
  laundry?: LaundryPolicy | null;
  dishwasher?: DishwasherPolicy | null;
  ac?: AcPolicy | null;
  outdoor_space?: OutdoorSpacePolicy | null;
}): number {
  return (
    LAUNDRY_RANK[row.laundry ?? "unknown"] * 1000 +
    AC_RANK[row.ac ?? "unknown"] * 100 +
    OUTDOOR_RANK[row.outdoor_space ?? "unknown"] * 10 +
    DISHWASHER_RANK[row.dishwasher ?? "unknown"]
  );
}

/**
 * Which way a column sorts on its first click. Alphabetical columns read best
 * ascending; "most yeses" and "newest" only make sense descending.
 */
export function defaultSortDir(key: SortKey): "asc" | "desc" {
  return key === "votes" || key === "created_at" ? "desc" : "asc";
}

/**
 * Seconds on transit from this listing to one saved place, or null when there
 * is no usable answer — no starred place, no cached row, or a row Google
 * refused (`error` set, `seconds` null). Null is what makes the cell print an
 * em dash and the sort sink the row, which is the same thing an unanswered
 * question does everywhere else in this table.
 */
export function transitSeconds(
  row: Pick<ListingRow, "commute_times">,
  locationId: Uuid | null,
): number | null {
  if (!locationId) return null;
  const match = row.commute_times?.find(
    (commute) => commute.location_id === locationId && commute.mode === "transit",
  );
  const seconds = match?.seconds;
  return seconds != null && seconds > 0 ? seconds : null;
}

function num(raw: string): number | null {
  const n = Number(raw);
  return raw.trim() === "" || Number.isNaN(n) ? null : n;
}

export function applyFilters(
  rows: ListingRow[],
  f: Filters,
  personId: Uuid | null = null,
): ListingRow[] {
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
    if (f.pets !== "all" && (r.pets ?? "unknown") !== f.pets) return false;
    if (f.laundry !== "all" && (r.laundry ?? "unknown") !== f.laundry) return false;
    if (f.dishwasher !== "all" && (r.dishwasher ?? "unknown") !== f.dishwasher) {
      return false;
    }
    if (f.ac !== "all" && (r.ac ?? "unknown") !== f.ac) return false;
    if (
      f.outdoor_space !== "all" &&
      (r.outdoor_space ?? "unknown") !== f.outdoor_space
    ) {
      return false;
    }
    if (!matchesMyVote(r.votes, personId, f.myVote)) return false;
    return true;
  });
}

function sortValue(
  row: ListingRow,
  key: SortKey,
  primaryLocationId: Uuid | null,
): string | number | null {
  switch (key) {
    case "address":
      return `${row.address ?? ""} ${row.unit ?? ""}`.toLowerCase();
    case "broker":
      return row.broker?.name?.toLowerCase() ?? null;
    case "neighborhood":
      return row.neighborhood?.toLowerCase() ?? null;
    case "pets":
      // Ranked, not alphabetical: sorting "Pets" should walk from the ones you
      // can move into to the ones you cannot, and `cats_only < yes` as text
      // would bury the answer everyone is looking for. Null reads as
      // `unknown`, the column default, so it sorts last rather than sinking
      // as a blank.
      return PETS_RANK[row.pets ?? "unknown"];
    case "amenities":
      // One packed rank for four columns — see `amenityRank`. Ascending walks
      // from the apartment with a washer in it to the one nobody has asked
      // about, which is the direction anyone scanning this column wants.
      return amenityRank(row);
    case "status":
      return row.status ?? null;
    case "votes":
      // One number: yes count first, nos as the tie-break (see `voteScore`).
      return voteScore(row.votes);
    case "next_action_due":
      return row.next_action_due ?? null;
    case "transitToPrimary":
      // Seconds rather than the rounded minutes the cell shows: two listings a
      // few seconds apart should still have a defined order.
      return transitSeconds(row, primaryLocationId);
    case "created_at":
      return row.created_at ?? null;
    default:
      return row[key] ?? null;
  }
}

/**
 * Blanks always sink to the bottom, whichever direction is active.
 *
 * `primaryLocationId` is only read by the `transitToPrimary` key and comes
 * from `src/lib/prefs.ts` — a device preference, not a column, which is why it
 * arrives as an argument instead of being looked up in here.
 */
export function sortRows(
  rows: ListingRow[],
  sort: Sort,
  primaryLocationId: Uuid | null = null,
): ListingRow[] {
  const factor = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = sortValue(a, sort.key, primaryLocationId);
    const vb = sortValue(b, sort.key, primaryLocationId);
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
