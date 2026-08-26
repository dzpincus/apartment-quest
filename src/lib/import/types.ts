/**
 * The wire shape of `POST /api/import`. Lives here rather than in the route so
 * the panel can import it without dragging a `server-only` module into the
 * client bundle — everything in this file is types, which compile away.
 */

import type { ListingFormValues } from "@/components/listings/listing-form";
import type { FormKey, ImportedBroker } from "./coerce";

/** Which rung of the ladder produced the text we extracted from. */
export type ImportSource = "direct" | "firecrawl" | "paste";

export type ImportSuccess = {
  fields: Partial<ListingFormValues>;
  broker: ImportedBroker | null;
  filledKeys: FormKey[];
  photos: string[];
  source: ImportSource;
  confidence: number;
  warnings: string[];
  title: string | null;
  /** Set when this exact URL is already on the board and the user imported anyway. */
  existingListingId?: string;
};

/** The site said no. 200, not 500 — this is an expected outcome, and the
 *  paste box below it is the fix. */
export type ImportBlocked = {
  blocked: true;
  reason: string;
  /** Rungs we actually tried, for the log line and the copy. */
  tried: ImportSource[];
};

/** No `ANTHROPIC_API_KEY` on the server. */
export type ImportDisabled = { disabled: true; error: string };

/** Pre-check hit: this URL is already a listing. Nothing was extracted. */
export type ImportExisting = {
  alreadyAdded: true;
  existingListingId: string;
  existingAddedBy: string | null;
  existingLabel: string;
};

export type ImportFailure = { error: string };

export type ImportResponse =
  | ImportSuccess
  | ImportBlocked
  | ImportDisabled
  | ImportExisting
  | ImportFailure;

export function isBlocked(r: ImportResponse): r is ImportBlocked {
  return "blocked" in r && r.blocked === true;
}
export function isDisabled(r: ImportResponse): r is ImportDisabled {
  return "disabled" in r && r.disabled === true;
}
export function isExisting(r: ImportResponse): r is ImportExisting {
  return "alreadyAdded" in r && r.alreadyAdded === true;
}
export function isFailure(r: ImportResponse): r is ImportFailure {
  return "error" in r && !("disabled" in r);
}
export function isSuccess(r: ImportResponse): r is ImportSuccess {
  return "fields" in r;
}
