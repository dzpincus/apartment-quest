/**
 * Hand-written row types mirroring supabase/migrations/0001_schema.sql.
 * Keep in sync by hand — there is no codegen in this project.
 */

export type Uuid = string;
/** ISO-8601 UTC timestamp. */
export type Timestamptz = string;
/** `yyyy-MM-dd`. */
export type DateOnly = string;

export type ListingStatus =
  | "saved"
  | "contacted"
  | "tour_scheduled"
  | "toured"
  | "applied"
  | "passed"
  | "lost";

export type FeeType = "no_fee" | "fee" | "op" | "unknown";
/** Pet policy. `unknown` is the column default — nobody has asked yet. */
export type PetsPolicy = "yes" | "cats_only" | "dogs_only" | "no" | "unknown";

/**
 * Amenities (0009). Four separate columns rather than a bag of booleans,
 * because "laundry" has three useful answers and a boolean would flatten
 * "in the basement" into "yes". `unknown` is the column default on all four
 * and means nobody has asked yet — never "no", and treated as an absence by
 * `merge_listings` and by `blankForMerge`, exactly like `pets`.
 */
export type LaundryPolicy = "in_unit" | "in_building" | "none" | "unknown";
export type DishwasherPolicy = "yes" | "no" | "unknown";
export type AcPolicy = "central" | "window" | "none" | "unknown";
export type OutdoorSpacePolicy = "private" | "shared" | "none" | "unknown";
/**
 * What the source page said last time the sync run looked (0006). Never the
 * same thing as `ListingStatus`, which is what *we* decided: a page that
 * vanished does not make a listing `lost` — a human does that.
 *
 * `unknown` is the column default and means "nobody has looked yet", which is
 * also where a listing stays when the site blocks every check.
 */
export type ListingState = "active" | "off_market" | "removed" | "unknown";

/**
 * The three ways to get somewhere (0010). Ours, not Google's — the mapping to
 * `WALK` / `BICYCLE` / `TRANSIT` lives in `src/lib/geo/routes.ts`, so swapping
 * routing providers never reaches the database.
 */
export type CommuteMode = "walk" | "bike" | "transit";

export const COMMUTE_MODES: readonly CommuteMode[] = ["walk", "bike", "transit"];

export type VoteValue = "yes" | "no" | "maybe";
export type InteractionKind = "call" | "email" | "text" | "tour" | "note";

export type ActivityVerb =
  | "added_listing"
  | "edited_listing"
  | "changed_status"
  | "voted"
  | "messaged"
  | "logged_interaction"
  | "added_broker"
  | "set_next_action"
  | "updated_document"
  | "merged_listing"
  | "added_photos"
  /** Written by Quest Bot from `/api/sync` — the listing page moved on. */
  | "listing_state_changed"
  /** Saved places (0010). "added location Work" / "removed location Gym". */
  | "added_location"
  | "removed_location";

export type EntityType =
  | "listing"
  | "broker"
  | "message"
  | "document"
  /** A saved place (0010). There is no page for one, so `activityHref` leaves
   *  the feed row as text — the dialog on the map and the commute card is
   *  where locations are managed. */
  | "location";

export type DocType =
  | "pay_stubs"
  | "bank_statements"
  | "tax_return"
  | "employment_letter"
  | "id"
  | "credit_report"
  | "guarantor_packet";

export type DocStatus = "missing" | "ready" | "expired";

export type Person = {
  id: Uuid;
  key: string;
  name: string;
  color: string | null;
  annual_income: number | null;
  created_at: Timestamptz | null;
};

export type Broker = {
  id: Uuid;
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  created_at: Timestamptz | null;
};

export type Listing = {
  id: Uuid;
  address: string;
  unit: string | null;
  neighborhood: string | null;
  rent: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  url: string | null;
  available_date: DateOnly | null;
  fee_type: FeeType | null;
  broker_fee_pct: number | null;
  guarantor_ok: boolean | null;
  income_multiplier: number | null;
  trains: string | null;
  notes: string | null;
  pets: PetsPolicy | null;
  pet_notes: string | null;
  /** Amenity columns (0009). Null is the pre-migration shape of `'unknown'`. */
  laundry: LaundryPolicy | null;
  dishwasher: DishwasherPolicy | null;
  ac: AcPolicy | null;
  outdoor_space: OutdoorSpacePolicy | null;
  broker_id: Uuid | null;
  added_by: Uuid | null;
  status: ListingStatus | null;
  /** Sync columns (0006). Written only by `/api/sync` and `setListingState`. */
  listing_state: ListingState | null;
  state_checked_at: Timestamptz | null;
  /** The evidence, in the page's own words. A note starting with `blocked`
   *  means the last check never saw the page at all. */
  state_note: string | null;
  last_contacted_at: Timestamptz | null;
  next_action: string | null;
  next_action_due: DateOnly | null;
  next_action_owner: Uuid | null;
  /**
   * Where the building is (0010). Written by `POST /api/geocode` and by
   * drag-to-correct on the detail map; nulled by a trigger the moment
   * `address` or `unit` changes, because a pin is an answer about an address.
   *
   * `geocode_note` is provenance, not status: `'nyc-geosearch'`,
   * `'nominatim'`, `'low-confidence (nyc-geosearch)'` — worth a human glance —
   * or `'failed: …'`. A null `lat` with a `failed:` note means we looked; a
   * null `lat` with no note means nobody has.
   */
  lat: number | null;
  lng: number | null;
  geocoded_at: Timestamptz | null;
  geocode_note: string | null;
  /** Generated column — never write to it. */
  dedupe_key: string;
  merged_into: Uuid | null;
  created_at: Timestamptz | null;
  updated_at: Timestamptz | null;
};

/**
 * One stored image (0007_photos.sql). `storage_path` and `thumb_path` are
 * paths *inside* the `listing-photos` bucket — `photoUrl()` in
 * `src/lib/photos-client.ts` is the only thing that turns them into URLs.
 *
 * `source_url` is null for a manual upload; imported photos keep the CDN link
 * they came from as provenance. `width`/`height` describe the main image after
 * re-encoding, so a gallery can reserve space before it loads.
 */
export type ListingPhoto = {
  id: Uuid;
  listing_id: Uuid;
  storage_path: string;
  thumb_path: string;
  source_url: string | null;
  width: number | null;
  height: number | null;
  bytes: number | null;
  sort: number;
  added_by: Uuid | null;
  created_at: Timestamptz | null;
};

/**
 * A saved place (0010) — work, the gym, somebody's parents. Shared by all four
 * people on purpose: one hunt, one list. *Which* of them a given device shows
 * is a preference, not data, and lives in localStorage (`src/lib/prefs.ts`).
 *
 * `lat`/`lng` are NOT NULL: a location is geocoded before its row is written,
 * so "a saved place with no coordinates" is not a state this table can be in.
 */
export type Location = {
  id: Uuid;
  name: string;
  address: string;
  lat: number;
  lng: number;
  /** Free text, one glyph, for the pin. Optional. */
  emoji: string | null;
  added_by: Uuid | null;
  created_at: Timestamptz | null;
};

/**
 * One cached answer from the Routes API (0010): listing × location × mode.
 *
 * `seconds`/`meters` null with `error` set is a pair Google refused — the card
 * shows "—" with the reason in a tooltip, and the Google Maps deep link beside
 * it still works, because that costs nothing and needs no key.
 */
export type CommuteTime = {
  listing_id: Uuid;
  location_id: Uuid;
  mode: CommuteMode;
  seconds: number | null;
  meters: number | null;
  computed_at: Timestamptz | null;
  error: string | null;
};

export type Interaction = {
  id: Uuid;
  listing_id: Uuid | null;
  person_id: Uuid | null;
  kind: InteractionKind | null;
  notes: string | null;
  occurred_at: Timestamptz | null;
};

export type Vote = {
  listing_id: Uuid;
  person_id: Uuid;
  vote: VoteValue | null;
  comment: string | null;
  updated_at: Timestamptz | null;
};

/** `listing_id === null` means the global thread. */
export type Message = {
  id: Uuid;
  listing_id: Uuid | null;
  person_id: Uuid;
  body: string;
  created_at: Timestamptz | null;
};

export type ThreadRead = {
  person_id: Uuid;
  listing_id: Uuid;
  last_read_at: Timestamptz | null;
};

export type GlobalRead = {
  person_id: Uuid;
  last_read_at: Timestamptz | null;
};

export type Activity = {
  id: Uuid;
  person_id: Uuid;
  verb: ActivityVerb;
  entity_type: EntityType | null;
  entity_id: Uuid | null;
  summary: string;
  created_at: Timestamptz | null;
};

export type Document = {
  id: Uuid;
  person_id: Uuid | null;
  doc_type: DocType;
  drive_url: string | null;
  status: DocStatus | null;
  updated_at: Timestamptz | null;
};

export type DocShare = {
  id: Uuid;
  listing_id: Uuid | null;
  shared_with: string | null;
  shared_by: Uuid | null;
  shared_at: Timestamptz | null;
  revoked_at: Timestamptz | null;
};

/** Return shape of the `unread_counts(p_person uuid)` RPC. */
export type UnreadCount = {
  listing_id: Uuid | null;
  unread: number;
};

/** Insert payloads: server-defaulted columns are optional. */
export type NewListing = Omit<
  Listing,
  "id" | "dedupe_key" | "created_at" | "updated_at"
> & { id?: Uuid };
export type NewBroker = Omit<Broker, "id" | "created_at"> & { id?: Uuid };
export type NewLocation = Omit<Location, "id" | "created_at"> & { id?: Uuid };
export type NewInteraction = Omit<Interaction, "id" | "occurred_at"> & {
  occurred_at?: Timestamptz;
};
export type NewMessage = Omit<Message, "id" | "created_at">;
export type NewActivity = Omit<Activity, "id" | "created_at">;
