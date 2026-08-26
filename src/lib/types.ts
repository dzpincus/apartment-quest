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
  | "added_photos";

export type EntityType = "listing" | "broker" | "message" | "document";

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
  broker_id: Uuid | null;
  added_by: Uuid | null;
  status: ListingStatus | null;
  last_contacted_at: Timestamptz | null;
  next_action: string | null;
  next_action_due: DateOnly | null;
  next_action_owner: Uuid | null;
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
export type NewInteraction = Omit<Interaction, "id" | "occurred_at"> & {
  occurred_at?: Timestamptz;
};
export type NewMessage = Omit<Message, "id" | "created_at">;
export type NewActivity = Omit<Activity, "id" | "created_at">;
