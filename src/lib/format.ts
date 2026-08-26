/** Display formatting helpers. Dates live in `time.ts`. */

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** `$3,200`. Empty string for null so table cells stay quiet. */
export function money(n: number | null | undefined): string {
  return n == null ? "" : usd.format(n);
}

/** `$310k` — for the qualification column, where precision is noise. */
export function moneyShort(n: number | null | undefined): string {
  if (n == null) return "";
  if (Math.abs(n) < 1000) return usd.format(n);
  return `$${Math.round(n / 1000).toLocaleString("en-US")}k`;
}

/** `2 bd / 1.5 ba`, skipping whichever half is missing. */
export function bedsBaths(
  beds: number | null | undefined,
  baths: number | null | undefined,
): string {
  const parts: string[] = [];
  if (beds != null) parts.push(`${beds} bd`);
  if (baths != null) parts.push(`${baths} ba`);
  return parts.join(" / ");
}

export const FEE_TYPE_LABELS = {
  no_fee: "No fee",
  fee: "Fee",
  op: "OP",
  unknown: "Unknown",
} as const;

export const STATUS_LABELS = {
  saved: "Saved",
  contacted: "Contacted",
  tour_scheduled: "Tour scheduled",
  toured: "Toured",
  applied: "Applied",
  passed: "Passed",
  lost: "Lost",
} as const;

/**
 * What the *source page* says (`listing_state`, 0006) — never what we decided,
 * which is `STATUS_LABELS` above. Short, because these go in a chip beside a
 * "checked 3h ago". `unknown` reads as "nobody has looked", not as a fact.
 */
export const LINK_STATE_LABELS = {
  active: "Still up",
  off_market: "Off market",
  removed: "Page gone",
  unknown: "Not checked",
} as const;

/** Long form, for selects and the detail page. */
export const PETS_LABELS = {
  yes: "Pets OK",
  cats_only: "Cats only",
  dogs_only: "Dogs only",
  no: "No pets",
  unknown: "Unknown",
} as const;

/**
 * Short form for the table and the cards, where "Pets OK" would eat a column.
 * `unknown` is an em dash rather than a word: an unanswered question should
 * read as quiet as a blank cell, not as a fact about the apartment.
 */
export const PETS_MARKS = {
  yes: "🐾 OK",
  cats_only: "🐱 Cats",
  dogs_only: "🐶 Dogs",
  no: "🚫 No",
  unknown: "—",
} as const;

export const INTERACTION_KIND_LABELS = {
  call: "Call",
  text: "Text",
  email: "Email",
  tour: "Tour",
  note: "Note",
} as const;

/** Address as people say it: "214 Grand St #4B". */
export function listingLabel(
  address: string | null | undefined,
  unit?: string | null | undefined,
): string {
  const a = (address ?? "").trim() || "(no address)";
  const u = (unit ?? "").trim();
  return u ? `${a} #${u.replace(/^#/, "")}` : a;
}
