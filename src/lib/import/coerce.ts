/**
 * Whatever the model handed back -> the add form's value shape. Pure and
 * tested, because this is the layer that has to assume the LLM lied: a yearly
 * rent, a bath count of 47, `"N/A"` in a date, the unit stuffed onto the end
 * of the address, an enum that is nearly right.
 *
 * Everything in `ListingFormValues` is a string (see `listing-form.ts`), so
 * every number here comes out as a string too. Nothing is ever `null`: a field
 * we could not read is simply absent from `fields`, which is what lets the
 * dialog's "fill the blanks only" merge work.
 */

import {
  LISTING_FORM_DEFAULTS,
  type ListingFormValues,
} from "@/components/listings/listing-form";
import { normalizeListingUrl } from "@/lib/url";

/** The `record_listing` tool's output, before anyone has checked it. */
export type RawExtract = {
  address?: string | null;
  unit?: string | null;
  neighborhood?: string | null;
  rent?: number | string | null;
  beds?: number | string | null;
  baths?: number | string | null;
  sqft?: number | string | null;
  available_date?: string | null;
  fee_type?: string | null;
  broker_fee_pct?: number | string | null;
  guarantor_ok?: string | null;
  pets?: string | null;
  pet_notes?: string | null;
  laundry?: string | null;
  dishwasher?: string | null;
  ac?: string | null;
  outdoor_space?: string | null;
  trains?: string | string[] | null;
  broker?: {
    name?: string | null;
    company?: string | null;
    phone?: string | null;
    email?: string | null;
  } | null;
  notes?: string | null;
  confidence?: number | string | null;
  source_title?: string | null;
};

export type ImportedBroker = {
  name: string;
  company: string;
  phone: string;
  email: string;
};

export type CoercedImport = {
  fields: Partial<ListingFormValues>;
  broker: ImportedBroker | null;
  filledKeys: FormKey[];
  /** 0-1. Below `LOW_CONFIDENCE` the panel says so out loud. */
  confidence: number;
  warnings: string[];
  title: string | null;
};

export type FormKey = keyof ListingFormValues;

/** A monthly rent outside this is a yearly figure, a typo, or a price per sqft. */
const RENT_MIN = 200;
const RENT_MAX = 50_000;
const LOW_CONFIDENCE = 0.4;

const FEE_TYPES = new Set(["no_fee", "fee", "op", "unknown"]);
const GUARANTOR = new Set(["yes", "no", "unknown"]);
const PETS = new Set(["yes", "cats_only", "dogs_only", "no", "unknown"]);
/** Amenities (0009). Same contract as every other enum here: anything that is
 *  not one of these values is dropped, never guessed at. */
const LAUNDRY = new Set(["in_unit", "in_building", "none", "unknown"]);
const DISHWASHER = new Set(["yes", "no", "unknown"]);
const AC = new Set(["central", "window", "none", "unknown"]);
const OUTDOOR_SPACE = new Set(["private", "shared", "none", "unknown"]);

/** `#4B` / `Apt 4B` / `Unit 4-B` hanging off the end of a street address. */
const TRAILING_UNIT_RE =
  /[,\s]+(?:#\s*([A-Za-z0-9-]+)|(?:Apt|Apartment|Unit|Ste|Suite)\.?\s*([A-Za-z0-9-]+))\s*$/i;

const NOTES_MAX = 300;

/**
 * Length caps on the free-text fields.
 *
 * `notes` was already capped; the rest were not, and a model that decides the
 * "address" is the page's whole breadcrumb trail — or a prompt-injected page
 * that hands back four kilobytes of instructions as a broker name — would put
 * all of it into an input the form renders on one line. A real NYC address is
 * under 60 characters; 120 is generous and still bounded.
 */
const ADDRESS_MAX = 120;
const NEIGHBORHOOD_MAX = 120;
const BROKER_TEXT_MAX = 120;
const PHONE_MAX = 40;
const EMAIL_MAX = 120;

/**
 * Loose on purpose: this is the difference between an email address and a
 * sentence, not RFC 5322. Anything that fails it is dropped rather than
 * truncated — half an email address is worse than none, because it looks
 * usable right up until someone tries it.
 */
const EMAIL_RE = /^[^\s@,;<>()]+@[^\s@,;<>()]+\.[A-Za-z]{2,}$/;

/** Trim, then cap. A cap on an untrimmed string can leave trailing whitespace. */
function capped(value: string, max: number): string {
  return value.length > max ? value.slice(0, max).trim() : value;
}

function str(v: unknown): string {
  if (v == null) return "";
  const s = String(v).trim();
  // Models love to fill a blank with a word that means blank.
  if (
    /^(n\/?a|none|null|unknown|undisclosed|tbd|not (listed|stated|specified|available|provided)|[-–—]{1,2})$/i.test(
      s,
    )
  ) {
    return "";
  }
  return s;
}

/**
 * `"$4,200/mo"` -> `4200`. Returns `null` when there is no number in there at
 * all, which is different from a number we then reject as implausible.
 */
export function parseAmount(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = str(v);
  if (!s) return null;
  if (/^(studio|no bedroom)/i.test(s)) return 0;
  const m = s.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

/** Round-trips through a string because the form only holds strings. */
function num(n: number, decimals = 0): string {
  const factor = 10 ** decimals;
  return String(Math.round(n * factor) / factor);
}

function enumOf(set: Set<string>, v: unknown): string | null {
  // `str()` reads the bare word "none" as an absence, which is right for free
  // text and wrong for the amenity enums (0009), where `none` is a real answer:
  // "this apartment has no laundry" is worth storing. Only the sets that
  // actually have a `none` member get the exemption.
  const bare = v == null ? "" : String(v).trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (bare === "none" && set.has("none")) return "none";

  const s = str(v).toLowerCase().replace(/[\s-]+/g, "_");
  if (!s) return null;
  if (set.has(s)) return s;
  // Near misses worth catching rather than dropping on the floor.
  if (set.has("no_fee") && /^(nofee|no_fee|nofeeapartment|free)$/.test(s)) return "no_fee";
  if (set.has("op") && /^(owner_?paid|op_?fee|owner_?pays)$/.test(s)) return "op";
  if (set.has("cats_only") && /^cats?$/.test(s)) return "cats_only";
  if (set.has("in_unit") && /^(in_?unit|washer_?dryer|w_?d_?in_?unit)$/.test(s)) {
    return "in_unit";
  }
  if (set.has("in_building") && /^(in_?building|building|laundry_?room|basement|on_?site)$/.test(s)) {
    return "in_building";
  }
  if (set.has("central") && /^(central_?air|central_?ac|central_?hvac)$/.test(s)) {
    return "central";
  }
  if (set.has("window") && /^(window_?unit|window_?ac)$/.test(s)) return "window";
  if (set.has("private") && /^(balcony|terrace|patio|yard|private_?outdoor)$/.test(s)) {
    return "private";
  }
  if (set.has("shared") && /^(roof_?deck|courtyard|common|shared_?outdoor)$/.test(s)) {
    return "shared";
  }
  if (set.has("dogs_only") && /^dogs?$/.test(s)) return "dogs_only";
  if (set.has("yes") && /^(true|allowed|ok|y)$/.test(s)) return "yes";
  if (set.has("no") && /^(false|not_allowed|n)$/.test(s)) return "no";
  return null;
}

/**
 * `yyyy-MM-dd`, or nothing. Accepts a full ISO timestamp (slice) and the
 * loose formats a model sometimes emits ("September 1, 2025"), using *local*
 * getters so a parsed midnight never slides into the previous day.
 */
export function parseDate(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const [, y, m, d] = iso;
    const valid =
      Number(m) >= 1 && Number(m) <= 12 && Number(d) >= 1 && Number(d) <= 31;
    return valid ? `${y}-${m}-${d}` : null;
  }
  const parsed = new Date(s);
  if (Number.isNaN(parsed.getTime())) return null;
  const y = parsed.getFullYear();
  if (y < 2000 || y > 2100) return null;
  const mm = String(parsed.getMonth() + 1).padStart(2, "0");
  const dd = String(parsed.getDate()).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

/** `"J, M, Z"` / `["J","M","Z"]` / `"J M Z trains"` -> `"J M Z"`. */
export function normalizeTrains(v: unknown): string {
  const raw = Array.isArray(v) ? v.join(" ") : str(v);
  if (!raw) return "";
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of raw.split(/[\s,/&]+/)) {
    const t = token.replace(/[^A-Za-z0-9]/g, "");
    if (!t || t.length > 3) continue; // "trains", "subway", "line"
    if (/^(the|and|to|at|or)$/i.test(t)) continue;
    const up = t.toUpperCase();
    if (seen.has(up)) continue;
    seen.add(up);
    out.push(up);
    if (out.length >= 8) break;
  }
  return out.join(" ");
}

/** Pull a trailing unit off an address when the model did not split it itself. */
export function splitUnit(address: string, unit: string): { address: string; unit: string } {
  if (unit.trim() || !address.trim()) return { address: address.trim(), unit: unit.trim() };
  const m = address.match(TRAILING_UNIT_RE);
  if (!m) return { address: address.trim(), unit: "" };
  const found = (m[1] ?? m[2] ?? "").trim();
  if (!found) return { address: address.trim(), unit: "" };
  return { address: address.slice(0, m.index).trim().replace(/[,\s]+$/, ""), unit: found };
}

function boundedNumber(
  raw: unknown,
  { min, max, decimals = 0 }: { min: number; max: number; decimals?: number },
): { value: string | null; rejected: number | null } {
  const n = parseAmount(raw);
  if (n == null) return { value: null, rejected: null };
  if (n < min || n > max) return { value: null, rejected: n };
  return { value: num(n, decimals), rejected: null };
}

export function coerceExtract(
  raw: RawExtract,
  opts: { url?: string | null } = {},
): CoercedImport {
  const fields: Partial<ListingFormValues> = {};
  const warnings: string[] = [];

  const split = splitUnit(str(raw.address), str(raw.unit));
  if (split.address) fields.address = capped(split.address, ADDRESS_MAX);
  if (split.unit) fields.unit = split.unit;

  const hood = str(raw.neighborhood);
  if (hood) fields.neighborhood = capped(hood, NEIGHBORHOOD_MAX);

  const rent = boundedNumber(raw.rent, { min: RENT_MIN, max: RENT_MAX });
  if (rent.value) fields.rent = rent.value;
  if (rent.rejected != null) {
    warnings.push(
      `Rent came back as ${rent.rejected.toLocaleString("en-US")} — that is not a monthly figure, so it was left blank.`,
    );
  }

  const beds = boundedNumber(raw.beds, { min: 0, max: 12, decimals: 1 });
  if (beds.value) fields.beds = beds.value;
  const baths = boundedNumber(raw.baths, { min: 0, max: 12, decimals: 1 });
  if (baths.value) fields.baths = baths.value;
  const sqft = boundedNumber(raw.sqft, { min: 50, max: 25_000 });
  if (sqft.value) fields.sqft = sqft.value;
  const feePct = boundedNumber(raw.broker_fee_pct, { min: 0, max: 100, decimals: 2 });
  if (feePct.value) fields.broker_fee_pct = feePct.value;

  const available = parseDate(raw.available_date);
  if (available) fields.available_date = available;

  const fee = enumOf(FEE_TYPES, raw.fee_type);
  if (fee && fee !== "unknown") fields.fee_type = fee as ListingFormValues["fee_type"];
  const guarantor = enumOf(GUARANTOR, raw.guarantor_ok);
  if (guarantor && guarantor !== "unknown") {
    fields.guarantor_ok = guarantor as ListingFormValues["guarantor_ok"];
  }
  const pets = enumOf(PETS, raw.pets);
  if (pets && pets !== "unknown") fields.pets = pets as ListingFormValues["pets"];

  // Amenities: `unknown` and anything unrecognised are absences, so a model
  // that shrugs can never overwrite what somebody typed. `none` is a real
  // answer and is kept — "this apartment has no laundry" is worth knowing.
  const laundry = enumOf(LAUNDRY, raw.laundry);
  if (laundry && laundry !== "unknown") {
    fields.laundry = laundry as ListingFormValues["laundry"];
  }
  const dishwasher = enumOf(DISHWASHER, raw.dishwasher);
  if (dishwasher && dishwasher !== "unknown") {
    fields.dishwasher = dishwasher as ListingFormValues["dishwasher"];
  }
  const ac = enumOf(AC, raw.ac);
  if (ac && ac !== "unknown") fields.ac = ac as ListingFormValues["ac"];
  const outdoor = enumOf(OUTDOOR_SPACE, raw.outdoor_space);
  if (outdoor && outdoor !== "unknown") {
    fields.outdoor_space = outdoor as ListingFormValues["outdoor_space"];
  }

  const petNotes = str(raw.pet_notes);
  if (petNotes) fields.pet_notes = petNotes.slice(0, NOTES_MAX);

  const trains = normalizeTrains(raw.trains);
  if (trains) fields.trains = trains;

  const notes = str(raw.notes);
  if (notes) fields.notes = notes.slice(0, NOTES_MAX);

  // Normalised on the way in, so the URL a listing is *stored* with is the same
  // string the next import's duplicate check compares against (`url.ts`).
  const url = str(opts.url);
  if (url) fields.url = normalizeListingUrl(url) || url;

  const brokerName = capped(str(raw.broker?.name), BROKER_TEXT_MAX);
  const brokerEmail = str(raw.broker?.email);
  const broker: ImportedBroker | null = brokerName
    ? {
        name: brokerName,
        company: capped(str(raw.broker?.company), BROKER_TEXT_MAX),
        phone: capped(str(raw.broker?.phone), PHONE_MAX),
        email:
          brokerEmail.length <= EMAIL_MAX && EMAIL_RE.test(brokerEmail) ? brokerEmail : "",
      }
    : null;

  const rawConfidence = parseAmount(raw.confidence);
  const confidence =
    rawConfidence == null ? 0.5 : Math.min(1, Math.max(0, rawConfidence));

  if (!fields.address) {
    warnings.push("Couldn't find the address — type it in before saving.");
  }
  if (confidence < LOW_CONFIDENCE) {
    warnings.push("That doesn't look like a single listing — check every field.");
  }

  return {
    fields,
    broker,
    filledKeys: filledKeysOf(fields),
    confidence,
    warnings,
    title: str(raw.source_title) || null,
  };
}

/**
 * Which keys actually carry information. A value equal to the form default
 * (`"unknown"`, `"none"`, `""`) is an absence, not an answer, and must not be
 * highlighted or counted in "filled 9 fields".
 */
export function filledKeysOf(fields: Partial<ListingFormValues>): FormKey[] {
  return (Object.keys(fields) as FormKey[]).filter((key) => {
    const value = fields[key];
    return (
      typeof value === "string" &&
      value.trim() !== "" &&
      value !== LISTING_FORM_DEFAULTS[key]
    );
  });
}
