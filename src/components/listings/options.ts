import type { SelectOption } from "@/components/simple-select";
import {
  AC_LABELS,
  DISHWASHER_LABELS,
  FEE_TYPE_LABELS,
  LAUNDRY_LABELS,
  OUTDOOR_LABELS,
  PETS_LABELS,
  STATUS_LABELS,
} from "@/lib/format";
import type { LinkStateFilter } from "@/lib/listing-filters";
import type {
  AcPolicy,
  DishwasherPolicy,
  FeeType,
  LaundryPolicy,
  ListingStatus,
  OutdoorSpacePolicy,
  PetsPolicy,
} from "@/lib/types";

export const STATUS_OPTIONS: SelectOption<ListingStatus>[] = (
  Object.keys(STATUS_LABELS) as ListingStatus[]
).map((value) => ({ value, label: STATUS_LABELS[value] }));

export const FEE_OPTIONS: SelectOption<FeeType>[] = (
  Object.keys(FEE_TYPE_LABELS) as FeeType[]
).map((value) => ({ value, label: FEE_TYPE_LABELS[value] }));

/** Ordered most permissive first, which is the order people care about. */
export const PETS_OPTIONS: SelectOption<PetsPolicy>[] = (
  ["yes", "cats_only", "dogs_only", "no", "unknown"] as PetsPolicy[]
).map((value) => ({ value, label: PETS_LABELS[value] }));

/**
 * Amenities (0009). Each list is ordered best-first — the same reason
 * `PETS_OPTIONS` is: the answer people are scanning for should be the first one
 * they read, and `unknown` (nobody asked) goes last rather than in the middle.
 */
export const LAUNDRY_OPTIONS: SelectOption<LaundryPolicy>[] = (
  ["in_unit", "in_building", "none", "unknown"] as LaundryPolicy[]
).map((value) => ({ value, label: LAUNDRY_LABELS[value] }));

export const DISHWASHER_OPTIONS: SelectOption<DishwasherPolicy>[] = (
  ["yes", "no", "unknown"] as DishwasherPolicy[]
).map((value) => ({ value, label: DISHWASHER_LABELS[value] }));

export const AC_OPTIONS: SelectOption<AcPolicy>[] = (
  ["central", "window", "none", "unknown"] as AcPolicy[]
).map((value) => ({ value, label: AC_LABELS[value] }));

export const OUTDOOR_OPTIONS: SelectOption<OutdoorSpacePolicy>[] = (
  ["private", "shared", "none", "unknown"] as OutdoorSpacePolicy[]
).map((value) => ({ value, label: OUTDOOR_LABELS[value] }));

export const STATUS_FILTER_OPTIONS: SelectOption<ListingStatus | "all">[] = [
  { value: "all", label: "Any status" },
  ...STATUS_OPTIONS,
];

export const FEE_FILTER_OPTIONS: SelectOption<FeeType | "all">[] = [
  { value: "all", label: "Any fee" },
  ...FEE_OPTIONS,
];

export const PETS_FILTER_OPTIONS: SelectOption<PetsPolicy | "all">[] = [
  { value: "all", label: "Any pets" },
  ...PETS_OPTIONS,
];

export const LAUNDRY_FILTER_OPTIONS: SelectOption<LaundryPolicy | "all">[] = [
  { value: "all", label: "Any laundry" },
  ...LAUNDRY_OPTIONS,
];

export const DISHWASHER_FILTER_OPTIONS: SelectOption<DishwasherPolicy | "all">[] = [
  { value: "all", label: "Any dishwasher" },
  ...DISHWASHER_OPTIONS,
];

export const AC_FILTER_OPTIONS: SelectOption<AcPolicy | "all">[] = [
  { value: "all", label: "Any AC" },
  ...AC_OPTIONS,
];

export const OUTDOOR_FILTER_OPTIONS: SelectOption<OutdoorSpacePolicy | "all">[] = [
  { value: "all", label: "Any outdoor" },
  ...OUTDOOR_OPTIONS,
];

/**
 * The link-state filter (0006). Every label says "Link:" out loud, because the
 * control sits next to "Any status" and the two answer different questions —
 * where *we* are versus what the *site* says.
 *
 * `not_gone` leads because it is the default: the table opens on live +
 * unchecked and keeps taken-down listings out of the way. "Link: any" is the
 * one below it, and unlike the others it *widens* the list, which is why it
 * still gets a chip.
 */
export const LINK_STATE_FILTER_OPTIONS: SelectOption<LinkStateFilter>[] = [
  { value: "not_gone", label: "Link: live + unchecked" },
  { value: "any", label: "Link: any" },
  { value: "live", label: "Link: live" },
  { value: "gone", label: "Link: gone" },
  { value: "unchecked", label: "Link: unchecked" },
];

/**
 * What the chips say. The prefix stays on: a pill reading just "Any" next to
 * one reading "Contacted" is a filter nobody can place, and every value here
 * is a *departure* from the default worth naming out loud. `not_gone` is the
 * default and so never wears a chip — the entry is here because the record is
 * total.
 */
export const LINK_STATE_CHIPS: Record<LinkStateFilter, string> = {
  not_gone: "Link: Live + unchecked",
  any: "Link: Any",
  live: "Link: Live",
  gone: "Link: Gone",
  unchecked: "Link: Unchecked",
};

/** `guarantor_ok` is a nullable boolean; the UI treats null as "unknown". */
export type GuarantorChoice = "yes" | "no" | "unknown";

export const GUARANTOR_OPTIONS: SelectOption<GuarantorChoice>[] = [
  { value: "unknown", label: "Unknown" },
  { value: "yes", label: "Guarantor OK" },
  { value: "no", label: "No guarantor" },
];

export function guarantorToChoice(v: boolean | null | undefined): GuarantorChoice {
  return v == null ? "unknown" : v ? "yes" : "no";
}

export function choiceToGuarantor(c: GuarantorChoice): boolean | null {
  return c === "unknown" ? null : c === "yes";
}
