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
