import type { SelectOption } from "@/components/simple-select";
import { FEE_TYPE_LABELS, PETS_LABELS, STATUS_LABELS } from "@/lib/format";
import type { FeeType, ListingStatus, PetsPolicy } from "@/lib/types";

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
