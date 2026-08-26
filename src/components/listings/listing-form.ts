/** Shape + validation for the add-listing modal. Everything is a string in the
 *  form and converted once, on submit. */

import { z } from "zod";
import type { ListingPatch } from "@/lib/mutations";
import { choiceToGuarantor, type GuarantorChoice } from "@/components/listings/options";

const numeric = (label: string) =>
  z
    .string()
    .trim()
    .refine(
      (v) => v === "" || (Number.isFinite(Number(v)) && Number(v) >= 0),
      `${label} must be a number`,
    );

/**
 * Shared with the detail page's inline "Link" edit, which bypasses this schema
 * entirely and would otherwise happily store `javascript:alert(1)` — the
 * anchor next to it renders whatever is in the column.
 */
export const URL_RE = /^https?:\/\/\S+$/;

export const listingSchema = z.object({
  address: z.string().trim().min(1, "Address is required"),
  unit: z.string().trim(),
  neighborhood: z.string().trim(),
  rent: numeric("Rent"),
  beds: numeric("Beds"),
  baths: numeric("Baths"),
  sqft: numeric("Sqft"),
  url: z
    .string()
    .trim()
    .refine((v) => v === "" || URL_RE.test(v), "Must start with http"),
  available_date: z.string().trim(),
  fee_type: z.enum(["no_fee", "fee", "op", "unknown"]),
  broker_fee_pct: numeric("Broker fee"),
  guarantor_ok: z.enum(["yes", "no", "unknown"]),
  income_multiplier: numeric("Income multiplier"),
  trains: z.string().trim(),
  notes: z.string().trim(),
  /** "none" = no broker. */
  broker_id: z.string(),
});

export type ListingFormValues = z.infer<typeof listingSchema>;

export const LISTING_FORM_DEFAULTS: ListingFormValues = {
  address: "",
  unit: "",
  neighborhood: "",
  rent: "",
  beds: "",
  baths: "",
  sqft: "",
  url: "",
  available_date: "",
  fee_type: "unknown",
  broker_fee_pct: "",
  guarantor_ok: "unknown",
  income_multiplier: "40",
  trains: "",
  notes: "",
  broker_id: "none",
};

const text = (v: string) => (v.trim() === "" ? null : v.trim());
const int = (v: string) => (v.trim() === "" ? null : Math.round(Number(v)));
const dec = (v: string) => (v.trim() === "" ? null : Number(v));

export function toListingPatch(values: ListingFormValues): ListingPatch & { address: string } {
  return {
    address: values.address.trim(),
    unit: text(values.unit),
    neighborhood: text(values.neighborhood),
    rent: int(values.rent),
    beds: dec(values.beds),
    baths: dec(values.baths),
    sqft: int(values.sqft),
    url: text(values.url),
    available_date: text(values.available_date),
    fee_type: values.fee_type,
    broker_fee_pct: dec(values.broker_fee_pct),
    guarantor_ok: choiceToGuarantor(values.guarantor_ok as GuarantorChoice),
    income_multiplier: dec(values.income_multiplier) ?? 40,
    trains: text(values.trains),
    notes: text(values.notes),
    broker_id: values.broker_id === "none" ? null : values.broker_id,
  };
}
