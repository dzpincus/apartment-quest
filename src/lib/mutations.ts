"use client";

/**
 * The only module in the app that writes to Supabase.
 *
 * Rules:
 * - Every write takes an explicit `personId` (from `usePerson()`), never reads
 *   localStorage itself.
 * - Every write that "leaves a mark" also inserts an `activity` row whose
 *   `summary` is rendered *at insert time* (SPEC: "Activity tracking"), so the
 *   feed stays a single cheap query and history stays readable after the
 *   underlying listing changes.
 * - Summaries are verb phrases without the actor's name ("added 214 Grand St
 *   #4B"): the feed groups rows by person and prints the name with their color,
 *   so baking it into the string would double it up.
 *
 * Later phases add their verbs here and nowhere else:
 * - Phase 6 (if ever): `setDocumentStatus` (updated_document).
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { queryKeys, type ListingRow, type VoteRow } from "@/lib/queries";
import { resizeImage, webpName } from "@/lib/images";
import { BATCH_TOO_BIG_MESSAGE, type SavePhotosResponse } from "@/lib/photo-types";
import { LINK_STATE_LABELS, listingLabel, STATUS_LABELS } from "@/lib/format";
import type { SyncResponse } from "@/lib/sync-types";
import type {
  CommutesRequest,
  CommutesResponse,
  GeocodeResponse,
} from "@/lib/geo-types";
import { upsertVote, withoutVote } from "@/lib/votes";
import { fmtDay } from "@/lib/time";
import type {
  ActivityVerb,
  Broker,
  DateOnly,
  EntityType,
  Interaction,
  InteractionKind,
  Listing,
  ListingState,
  ListingStatus,
  Location,
  Message,
  NewBroker,
  NewLocation,
  Uuid,
  Vote,
  VoteValue,
} from "@/lib/types";

/** Columns a person can type into. `dedupe_key` is generated; never sent. */
export type ListingPatch = Partial<
  Omit<Listing, "id" | "dedupe_key" | "created_at" | "updated_at">
>;

export type NewListingInput = ListingPatch & { address: string };

/**
 * Edits to these columns do not deserve a feed entry: `updated_at` is a
 * trigger, and the follow-up columns get their own `set_next_action` /
 * `logged_interaction` verbs in phase 3.
 */
const NOISY_COLUMNS = new Set<string>([
  "updated_at",
  "last_contacted_at",
  "next_action",
  "next_action_due",
  "next_action_owner",
  // The sync columns (0006) are written by a robot twice a day and by the
  // "Still live" button. Their news is the `listing_state_changed` line the
  // sync writes itself; an "edited (link status)" row on top of it would be
  // the same event twice, in the wrong words.
  "listing_state",
  "state_checked_at",
  "state_note",
  // The geo columns (0010) travel as a set and are written by one of two
  // things: the geocoder, which is a robot, or a dragged pin, which logs
  // itself. `lat` is left out of this list and labelled "map pin" below, so a
  // correction reads as one line rather than as four columns nobody types.
  "lng",
  "geocoded_at",
  "geocode_note",
]);

const FIELD_LABELS: Record<string, string> = {
  address: "address",
  unit: "unit",
  neighborhood: "neighborhood",
  rent: "rent",
  beds: "beds",
  baths: "baths",
  sqft: "sqft",
  url: "link",
  available_date: "available date",
  fee_type: "fee",
  broker_fee_pct: "broker fee",
  guarantor_ok: "guarantor",
  income_multiplier: "income multiplier",
  trains: "trains",
  notes: "notes",
  pets: "pets",
  pet_notes: "pet notes",
  laundry: "laundry",
  dishwasher: "dishwasher",
  ac: "AC",
  outdoor_space: "outdoor space",
  broker_id: "broker",
  lat: "map pin",
  added_by: "added by",
  status: "status",
  merged_into: "merge",
};

function blank(v: unknown) {
  return v === null || v === undefined || v === "";
}

/**
 * Columns whose default is `'unknown'` — an absence wearing a value's clothes.
 * `pets` (0005) plus the four amenities (0009).
 */
const UNKNOWN_IS_BLANK: ReadonlySet<string> = new Set([
  "pets",
  "laundry",
  "dishwasher",
  "ac",
  "outdoor_space",
]);

/**
 * "Nothing to say" for the merge backfill. These columns default to
 * `'unknown'`, so a plain `blank()` check would read the default as an answer,
 * refuse to fill it from the duplicate, and happily overwrite a real answer
 * with it. Mirrors the `case` arms in `merge_listings` (0005 for `pets`, 0009
 * for the amenities) — change one and change the other.
 */
export function blankForMerge(column: string, v: unknown) {
  return blank(v) || (UNKNOWN_IS_BLANK.has(column) && v === "unknown");
}

/** Loose equality: form inputs hand back strings where the row holds numbers. */
function sameValue(a: unknown, b: unknown) {
  if (blank(a) && blank(b)) return true;
  if (blank(a) !== blank(b)) return false;
  if (typeof a === "number" || typeof b === "number") {
    const na = Number(a);
    const nb = Number(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na === nb;
  }
  return a === b;
}

/** Column names in `patch` whose value actually differs from `prev`. */
export function meaningfulChanges(patch: ListingPatch, prev: Listing | null): string[] {
  return Object.keys(patch).filter((k) => {
    if (NOISY_COLUMNS.has(k)) return false;
    const next = (patch as Record<string, unknown>)[k];
    const before = prev ? (prev as unknown as Record<string, unknown>)[k] : undefined;
    return !sameValue(next, before);
  });
}

async function logActivity(args: {
  personId: Uuid;
  verb: ActivityVerb;
  entityType: EntityType;
  entityId: Uuid;
  summary: string;
}) {
  const { error } = await createClient().from("activity").insert({
    person_id: args.personId,
    verb: args.verb,
    entity_type: args.entityType,
    entity_id: args.entityId,
    summary: args.summary,
  });
  // A lost feed entry must not roll back a successful edit — surface, don't throw.
  if (error) console.error("activity insert failed", error);
}

// -- listings ----------------------------------------------------------------

export async function createListing(
  personId: Uuid,
  input: NewListingInput,
): Promise<Listing> {
  const { data, error } = await createClient()
    .from("listings")
    .insert({ ...input, added_by: personId })
    .select("*")
    .single();
  if (error) throw error;
  const listing = data as Listing;
  await logActivity({
    personId,
    verb: "added_listing",
    entityType: "listing",
    entityId: listing.id,
    summary: `added ${listingLabel(listing.address, listing.unit)}`,
  });
  return listing;
}

/**
 * `prev` is the row as last read, used purely to decide whether the edit is
 * worth a feed entry (SPEC: "only when a meaningful field changes, not on
 * every keystroke"). Pass null to force the entry.
 */
export async function updateListing(
  personId: Uuid,
  id: Uuid,
  patch: ListingPatch,
  prev: Listing | null,
): Promise<Listing> {
  const { data, error } = await createClient()
    .from("listings")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  const listing = data as Listing;

  const changed = prev === null ? Object.keys(patch).filter((k) => !NOISY_COLUMNS.has(k)) : meaningfulChanges(patch, prev);
  if (changed.length > 0) {
    const fields = changed.map((k) => FIELD_LABELS[k] ?? k).join(", ");
    await logActivity({
      personId,
      verb: "edited_listing",
      entityType: "listing",
      entityId: id,
      summary: `edited ${listingLabel(listing.address, listing.unit)} (${fields})`,
    });
  }
  return listing;
}

/** Nulls the whole follow-up triple. Shared by "passed/lost" and Clear. */
const NO_NEXT_ACTION = {
  next_action: null,
  next_action_due: null,
  next_action_owner: null,
} as const;

export async function setListingStatus(
  personId: Uuid,
  listing: Pick<Listing, "id" | "address" | "unit" | "status">,
  status: ListingStatus,
): Promise<Listing> {
  // A dead listing must leave the follow-up queue, or the queue fills with
  // things nobody intends to chase (SPEC: buckets are keyed off next_action_due).
  const patch =
    status === "passed" || status === "lost"
      ? { status, ...NO_NEXT_ACTION }
      : { status };
  const { data, error } = await createClient()
    .from("listings")
    .update(patch)
    .eq("id", listing.id)
    .select("*")
    .single();
  if (error) throw error;
  if (listing.status !== status) {
    await logActivity({
      personId,
      verb: "changed_status",
      entityType: "listing",
      entityId: listing.id,
      summary: `moved ${listingLabel(listing.address, listing.unit)} to ${STATUS_LABELS[status]}`,
    });
  }
  return data as Listing;
}

/**
 * What the *source page* says, as opposed to what we decided (`status`).
 *
 * Written by `/api/sync` on a schedule and by one button: "Still live" on
 * Home's Vanished? section, when a person has looked at the page themselves
 * and the robot was wrong. No activity row either way — a correction to a
 * machine's guess is not an impression, and the sync's own
 * `listing_state_changed` line already told the story. `state_checked_at`
 * moves because a human looking *is* a check, and it postpones the next
 * automatic one.
 */
export async function setListingState(
  _personId: Uuid,
  listing: Pick<Listing, "id">,
  state: ListingState,
  note: string | null,
): Promise<Listing> {
  const { data, error } = await createClient()
    .from("listings")
    .update({
      listing_state: state,
      state_note: note,
      state_checked_at: new Date().toISOString(),
    })
    .eq("id", listing.id)
    .select("*")
    .single();
  if (error) throw error;
  return data as Listing;
}

/**
 * "Check now" on the detail page: one listing, right now, hour gate skipped.
 *
 * Goes over the API route rather than through supabase-js because the fetch,
 * the ladder and the Anthropic key all live server-side — the same shape as
 * the photo writes. The route accepts a logged-in session *only* with
 * `?listing=`, so this cannot start a full crawl.
 */
export async function checkListingNow(listingId: Uuid): Promise<SyncResponse> {
  const res = await fetch(
    `/api/sync?listing=${encodeURIComponent(listingId)}&force=1`,
    { method: "POST" },
  );
  const body = (await res.json().catch(() => null)) as SyncResponse | null;
  if (!res.ok || !body) {
    throw new Error(body?.error ?? "Couldn't check that listing.");
  }
  return body;
}

/**
 * Folds `src` into `dst` via the `merge_listings` RPC (one transaction:
 * children repointed, empty `dst` fields backfilled, `src.merged_into = dst`).
 */
export async function mergeListings(
  personId: Uuid,
  src: Pick<Listing, "id" | "address" | "unit">,
  dstId: Uuid,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc("merge_listings", { src: src.id, dst: dstId });
  if (error) throw error;
  await logActivity({
    personId,
    verb: "merged_listing",
    entityType: "listing",
    entityId: dstId,
    summary: `merged a duplicate of ${listingLabel(src.address, src.unit)}`,
  });
}

/**
 * The add-form's "Merge" button: the duplicate was never inserted, so there is
 * nothing to fold — just backfill the existing row from what was typed.
 */
export async function mergeIntoExisting(
  personId: Uuid,
  existing: Listing,
  patch: ListingPatch,
): Promise<Listing> {
  const filled: ListingPatch = {};
  for (const [k, v] of Object.entries(patch)) {
    if (blankForMerge(k, v) || NOISY_COLUMNS.has(k)) continue;
    if (blankForMerge(k, (existing as unknown as Record<string, unknown>)[k])) {
      (filled as Record<string, unknown>)[k] = v;
    }
  }
  let listing = existing;
  if (Object.keys(filled).length > 0) {
    const { data, error } = await createClient()
      .from("listings")
      .update(filled)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw error;
    listing = data as Listing;
  }
  await logActivity({
    personId,
    verb: "merged_listing",
    entityType: "listing",
    entityId: listing.id,
    summary: `merged a duplicate of ${listingLabel(listing.address, listing.unit)}`,
  });
  return listing;
}

// -- follow-up ---------------------------------------------------------------

/**
 * Verb phrases for the feed, one per interaction kind. "called broker about X"
 * rather than "logged a call on X": the feed reads as a sentence.
 */
const INTERACTION_SUMMARY: Record<InteractionKind, (label: string) => string> = {
  call: (l) => `called broker about ${l}`,
  text: (l) => `texted about ${l}`,
  email: (l) => `emailed about ${l}`,
  tour: (l) => `toured ${l}`,
  note: (l) => `noted on ${l}`,
};

/**
 * One contact: the `interactions` row, the `last_contacted_at` bump that makes
 * the cold bucket work, and — if the listing was still merely `saved` — the
 * automatic move to `contacted`.
 *
 * That implicit status bump deliberately does *not* write a second
 * `changed_status` row: one contact is one impression, and "called broker about
 * X" followed by "moved X to Contacted" would just be the same event twice.
 */
export async function logInteraction(
  personId: Uuid,
  listing: Pick<Listing, "id" | "address" | "unit" | "status">,
  input: { kind: InteractionKind; notes?: string | null },
): Promise<Interaction> {
  const supabase = createClient();
  // One statement, one transaction: the interaction row, the `last_contacted_at`
  // bump and the status move either all land or none do. As three client round
  // trips a dropped connection could leave a listing `contacted` with no history
  // behind it (`log_interaction`, 0004_review_fixes.sql). The RPC also decides
  // the status move from the stored row rather than from this cached copy.
  const { data, error } = await supabase.rpc("log_interaction", {
    p_person: personId,
    p_listing: listing.id,
    p_kind: input.kind,
    p_notes: input.notes ?? null,
  });
  if (error) throw error;
  // A single-composite return arrives as an object; tolerate the array shape
  // too, since that is a PostgREST version detail and not a contract.
  const interaction = (Array.isArray(data) ? data[0] : data) as Interaction;

  await logActivity({
    personId,
    verb: "logged_interaction",
    entityType: "listing",
    entityId: listing.id,
    summary: INTERACTION_SUMMARY[input.kind](listingLabel(listing.address, listing.unit)),
  });
  return interaction;
}

/**
 * The forced follow-up. `ownerName` is passed in rather than looked up because
 * the summary is rendered at insert time and must survive later renames of
 * nothing at all — it is a snapshot of what was decided.
 */
export async function setNextAction(
  personId: Uuid,
  listing: Pick<Listing, "id" | "address" | "unit">,
  input: {
    nextAction: string;
    dueDate: DateOnly;
    ownerId: Uuid | null;
    ownerName?: string | null;
  },
): Promise<Listing> {
  const nextAction = input.nextAction.trim();
  const { data, error } = await createClient()
    .from("listings")
    .update({
      next_action: nextAction,
      next_action_due: input.dueDate,
      next_action_owner: input.ownerId,
    })
    .eq("id", listing.id)
    .select("*")
    .single();
  if (error) throw error;

  const who = input.ownerName ? `, ${input.ownerName}` : "";
  await logActivity({
    personId,
    verb: "set_next_action",
    entityType: "listing",
    entityId: listing.id,
    summary: `set next action on ${listingLabel(listing.address, listing.unit)}: ${nextAction} (due ${fmtDay(input.dueDate)}${who})`,
  });
  return data as Listing;
}

export async function clearNextAction(
  personId: Uuid,
  listing: Pick<Listing, "id" | "address" | "unit">,
): Promise<Listing> {
  const { data, error } = await createClient()
    .from("listings")
    .update(NO_NEXT_ACTION)
    .eq("id", listing.id)
    .select("*")
    .single();
  if (error) throw error;
  await logActivity({
    personId,
    verb: "set_next_action",
    entityType: "listing",
    entityId: listing.id,
    summary: `cleared next action on ${listingLabel(listing.address, listing.unit)}`,
  });
  return data as Listing;
}

// -- messages ----------------------------------------------------------------

export type PostMessageInput = {
  /** `null` is the global thread. */
  listingId: Uuid | null;
  body: string;
  /**
   * Pre-rendered address for the activity summary. Optional: `postMessage`
   * looks it up if the caller does not have the listing to hand.
   */
  label?: string | null;
};

/** Reading a thread is an observation, not an impression — no activity row. */
export async function markThreadRead(
  personId: Uuid,
  listingId: Uuid | null,
): Promise<void> {
  // `last_read_at` is stamped server-side (`mark_thread_read`,
  // 0004_review_fixes.sql). A browser clock running fast used to mark messages
  // read *before* they were written, so the badge cleared and the message never
  // came back. The RPC also picks the table: the global thread lives in
  // `global_reads` because `thread_reads.listing_id` is part of the primary key
  // and Postgres will not enforce uniqueness over a null.
  const { error } = await createClient().rpc("mark_thread_read", {
    p_person: personId,
    p_listing: listingId,
  });
  if (error) throw error;
}

/**
 * Post to the global thread (`listingId: null`) or a listing's thread.
 *
 * The activity row points at the *listing* for a per-listing message, so the
 * feed can link it; a global message has nothing to link to, so it is filed
 * under the message itself and renders as plain text.
 *
 * Posting also marks the thread read for the author: you have obviously seen
 * your own message, and without this the badge would light up for the sender
 * on the next `unread_counts` refresh.
 */
export async function postMessage(
  personId: Uuid,
  input: PostMessageInput,
): Promise<Message> {
  const body = input.body.trim();
  if (!body) throw new Error("Nothing to send");
  const supabase = createClient();

  const { data, error } = await supabase
    .from("messages")
    .insert({ listing_id: input.listingId, person_id: personId, body })
    .select("*")
    .single();
  if (error) throw error;
  const message = data as Message;

  let label = input.label?.trim() || null;
  if (input.listingId && !label) {
    const { data: listing } = await supabase
      .from("listings")
      .select("address, unit")
      .eq("id", input.listingId)
      .maybeSingle();
    label = listing ? listingLabel(listing.address, listing.unit) : null;
  }

  await logActivity({
    personId,
    verb: "messaged",
    entityType: input.listingId ? "listing" : "message",
    entityId: input.listingId ?? message.id,
    summary: input.listingId
      ? `messaged about ${label ?? "a listing"}`
      : "messaged in the group chat",
  });

  // Best effort: a failed read marker must not fail the send.
  try {
    await markThreadRead(personId, input.listingId);
  } catch (readError) {
    console.error("thread read marker failed", readError);
  }

  return message;
}

// -- votes -------------------------------------------------------------------

export type CastVoteInput = {
  /** The address is needed for the pre-rendered summary, so pass the row. */
  listing: Pick<Listing, "id" | "address" | "unit">;
  /** `null` keeps the row for its comment without taking a side. */
  vote: VoteValue | null;
  comment?: string | null;
  /**
   * This person's vote as last read. Used only to word the summary
   * ("voted yes" vs "changed vote to maybe" vs "commented") and to keep a
   * no-op blur out of the feed. Pass `undefined` to force an entry.
   */
  prev?: Pick<Vote, "vote" | "comment"> | null;
};

function sameComment(a: string | null | undefined, b: string | null | undefined) {
  return (a?.trim() || "") === (b?.trim() || "");
}

/**
 * The feed line for a vote write, or null when nothing actually changed — a
 * comment input that blurs untouched must not fill the feed (SPEC: "log
 * impressions, not observations").
 */
export function voteSummary(
  label: string,
  vote: VoteValue | null,
  comment: string | null,
  prev: Pick<Vote, "vote" | "comment"> | null | undefined,
): string | null {
  const before = prev === undefined ? null : (prev?.vote ?? null);
  const known = prev !== undefined;
  if (vote !== before) {
    if (vote === null) return `withdrew vote on ${label}`;
    return before === null
      ? `voted ${vote} on ${label}`
      : `changed vote to ${vote} on ${label}`;
  }
  // Same side as before: only a new comment is worth a line.
  if (known && sameComment(comment, prev?.comment)) return null;
  return vote === null
    ? `commented on ${label}`
    : `commented on their vote for ${label}`;
}

/** Upsert on (listing_id, person_id) — one vote per person per listing. */
export async function castVote(personId: Uuid, input: CastVoteInput): Promise<Vote> {
  const comment = input.comment?.trim() || null;
  const { data, error } = await createClient()
    .from("votes")
    // `updated_at` is left to the default on insert and to the trigger on
    // update (0003_rpc_triggers.sql), so the clock stays server-side.
    .upsert(
      {
        listing_id: input.listing.id,
        person_id: personId,
        vote: input.vote,
        comment,
      },
      { onConflict: "listing_id,person_id" },
    )
    .select("*")
    .single();
  if (error) throw error;

  const summary = voteSummary(
    listingLabel(input.listing.address, input.listing.unit),
    input.vote,
    comment,
    input.prev,
  );
  if (summary) {
    await logActivity({
      personId,
      verb: "voted",
      entityType: "listing",
      entityId: input.listing.id,
      summary,
    });
  }
  return data as Vote;
}

/**
 * The feed line for a withdrawal, worded from what was actually deleted.
 * "Clear" also removes a comment-only row (one that was kept for its text
 * without taking a side), and calling that "withdrew vote" was a lie; deleting
 * a row that was not there at all is worth nothing.
 */
export function clearVoteSummary(
  label: string,
  removed: Pick<Vote, "vote" | "comment"> | null | undefined,
): string | null {
  if (!removed) return null;
  if (removed.vote) return `withdrew vote on ${label}`;
  if (removed.comment?.trim()) return `removed their comment on ${label}`;
  return null;
}

/** Withdraw: the row goes, so the widget shows "—" rather than a null vote. */
export async function clearVote(
  personId: Uuid,
  listing: Pick<Listing, "id" | "address" | "unit">,
): Promise<void> {
  // `select()` on the delete hands back what was removed, so the summary is
  // decided by the row that existed rather than by an assumption about it.
  const { data, error } = await createClient()
    .from("votes")
    .delete()
    .eq("listing_id", listing.id)
    .eq("person_id", personId)
    .select("vote, comment");
  if (error) throw error;

  const summary = clearVoteSummary(
    listingLabel(listing.address, listing.unit),
    (data ?? [])[0] as Pick<Vote, "vote" | "comment"> | undefined,
  );
  if (!summary) return;
  await logActivity({
    personId,
    verb: "voted",
    entityType: "listing",
    entityId: listing.id,
    summary,
  });
}

// -- brokers -----------------------------------------------------------------

export async function createBroker(
  personId: Uuid,
  input: Omit<NewBroker, "id">,
): Promise<Broker> {
  const { data, error } = await createClient()
    .from("brokers")
    .insert(input)
    .select("*")
    .single();
  if (error) throw error;
  const broker = data as Broker;
  await logActivity({
    personId,
    verb: "added_broker",
    entityType: "broker",
    entityId: broker.id,
    summary: `added broker ${broker.name}`,
  });
  return broker;
}

/** Broker edits are bookkeeping, not impressions — no activity row (SPEC). */
export async function updateBroker(
  _personId: Uuid,
  id: Uuid,
  patch: Partial<Omit<Broker, "id" | "created_at">>,
): Promise<Broker> {
  const { data, error } = await createClient()
    .from("brokers")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as Broker;
}

// -- photos ------------------------------------------------------------------
//
// The two photo writes go over `POST`/`DELETE /api/photos` rather than through
// supabase-js, because `sharp` and the storage paths live server-side. They are
// still exported from here: "all writes go through mutations.ts" is about where
// a component looks for a write, not about which transport it uses. The route
// writes the `added_photos` activity row itself, since it is the only thing
// that knows how many photos actually survived the trip.

/**
 * Upload files from a device. Each is shrunk in the browser first — a phone on
 * a subway platform should not push 4MB per photo for something the server will
 * re-encode to 1280px anyway — and `resizeImage` hands back the original file
 * whenever it cannot decode it, so a HEIC still reaches the route and comes
 * back with "Export as JPEG first" instead of vanishing here.
 */
export async function uploadPhotos(
  personId: Uuid | null,
  listingId: Uuid,
  files: File[],
): Promise<SavePhotosResponse> {
  const form = new FormData();
  form.set("listingId", listingId);
  if (personId) form.set("personId", personId);
  for (const file of files) {
    const blob = await resizeImage(file);
    form.append("files", blob, blob === file ? file.name : webpName(file.name));
  }

  const res = await fetch("/api/photos", { method: "POST", body: form });
  const body = (await res.json().catch(() => null)) as SavePhotosResponse | null;
  // 413 is the one failure with an action attached, and it is also the one
  // most likely to arrive with no JSON at all — the platform can refuse an
  // over-sized body before our route ever runs, and its answer is HTML. Say
  // the useful sentence in both cases rather than "Couldn't add those photos".
  if (res.status === 413) {
    throw new Error(body?.error || BATCH_TOO_BIG_MESSAGE);
  }
  // A partial success is a success: some photos landed, and the caller reports
  // the rest. Only "nothing saved" is worth throwing over.
  if (!body || (!res.ok && (body.photos?.length ?? 0) === 0)) {
    throw new Error(body?.error ?? "Couldn't add those photos.");
  }
  return { photos: body.photos ?? [], failed: body.failed ?? [], error: body.error };
}

/** Removes both objects and the row. No activity line — a deletion is not news. */
export async function deletePhoto(photoId: Uuid): Promise<void> {
  const res = await fetch("/api/photos", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ photoId }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Couldn't remove that photo.");
  }
}

// -- locations & the map -----------------------------------------------------
//
// Saved places are shared: one list, four people, and *which* of them a given
// device draws is a preference in localStorage (`src/lib/prefs.ts`), not a row.
// The two API-route writes below obey the "all writes go through mutations.ts"
// rule with a different transport, exactly like the photo writes: the geocoder
// and the Google key live server-side.

export type NewLocationInput = Omit<NewLocation, "added_by" | "id" | "emoji"> & {
  emoji?: string | null;
};

/**
 * A place worth measuring from. Geocoded *before* this is called (the dialog
 * previews the pin on blur), because `locations.lat/lng` are NOT NULL — a
 * saved place nobody can find is not a saved place.
 */
export async function createLocation(
  personId: Uuid,
  input: NewLocationInput,
): Promise<Location> {
  const { data, error } = await createClient()
    .from("locations")
    .insert({
      name: input.name.trim(),
      address: input.address.trim(),
      lat: input.lat,
      lng: input.lng,
      emoji: input.emoji?.trim() || null,
      added_by: personId,
    })
    .select("*")
    .single();
  if (error) throw error;
  const location = data as Location;
  await logActivity({
    personId,
    verb: "added_location",
    entityType: "location",
    entityId: location.id,
    summary: `added location ${location.name}`,
  });
  return location;
}

/**
 * Renaming a place or changing its glyph is bookkeeping, not an impression —
 * no activity row, the same call `updateBroker` makes. Moving it *is* worth
 * something, but the cached times are the thing that has to react, and the
 * dialog recomputes them rather than the feed narrating it.
 */
export async function updateLocation(
  _personId: Uuid,
  id: Uuid,
  patch: Partial<Omit<Location, "id" | "created_at" | "added_by">>,
): Promise<Location> {
  const { data, error } = await createClient()
    .from("locations")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as Location;
}

/**
 * Removing a place takes its cached commute times with it — `commute_times`
 * cascades on `location_id` (0010), so there is nothing to clean up here and
 * no orphan row to render a column from.
 */
export async function deleteLocation(
  personId: Uuid,
  location: Pick<Location, "id" | "name">,
): Promise<void> {
  const { error } = await createClient().from("locations").delete().eq("id", location.id);
  if (error) throw error;
  await logActivity({
    personId,
    verb: "removed_location",
    entityType: "location",
    entityId: location.id,
    summary: `removed location ${location.name}`,
  });
}

/**
 * Put a listing on the map. The route geocodes the *stored* address with the
 * admin client and writes `lat/lng/geocoded_at/geocode_note`, so the answer is
 * shared the moment it lands rather than being one device's opinion.
 *
 * A deployment with no admin key answers 503 `{ disabled: true }`, which is
 * returned rather than thrown: there is nothing a person can do about it and
 * the rest of the listing works fine without a pin.
 */
export async function geocodeListing(listingId: Uuid): Promise<GeocodeResponse> {
  return postGeo("/api/geocode", { listingId }, "Couldn't find that address.");
}

/** The locations dialog's preview: coordinates for an address, nothing written. */
export async function geocodeAddressPreview(
  address: string,
  unit?: string | null,
): Promise<GeocodeResponse> {
  return postGeo("/api/geocode", { address, unit: unit ?? null }, "Couldn't find that address.");
}

/**
 * Fill in the missing squares of the grid (listing x location x mode). Cheap
 * by construction: the route skips anything computed in the last 30 days
 * unless `force` says otherwise, so calling this after every geocode costs
 * nothing when there is nothing new to ask.
 */
export async function computeCommutes(
  args: CommutesRequest = {},
): Promise<CommutesResponse> {
  return postGeo("/api/commutes", args, "Couldn't work out the commute times.");
}

/** Shared transport for the two map routes. `disabled` is an answer, not a throw. */
async function postGeo<T extends { disabled?: boolean; error?: string }>(
  path: string,
  body: unknown,
  fallback: string,
): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const parsed = (await res.json().catch(() => null)) as T | null;
  if (parsed?.disabled) return parsed;
  if (!res.ok || !parsed) throw new Error(parsed?.error ?? fallback);
  return parsed;
}

/**
 * Drag-to-correct on the detail map. Goes through `updateListing` so the edit
 * is logged like any other ("edited 214 Grand St #4B (map pin)"), and stamps
 * `geocode_note: 'manual'` — a pin a person placed outranks anything a
 * geocoder guessed, and the "⚠ check pin" warning goes with it.
 */
export async function setListingCoords(
  personId: Uuid,
  listing: Pick<Listing, "id" | "address" | "unit">,
  lat: number,
  lng: number,
): Promise<Listing> {
  return updateListing(
    personId,
    listing.id,
    {
      lat,
      lng,
      geocoded_at: new Date().toISOString(),
      geocode_note: "manual",
    },
    null,
  );
}

/**
 * Did this edit move the building? Pure, so the auto-geocode below fires on an
 * address that actually changed rather than on every save of a form that
 * happens to include the address field.
 */
export function addressChanged(patch: ListingPatch, prev: Listing | null): boolean {
  if (!("address" in patch) && !("unit" in patch)) return false;
  if (!prev) return true;
  return meaningfulChanges(patch, prev).some((k) => k === "address" || k === "unit");
}

// -- people ------------------------------------------------------------------
// Renaming yourself and stating your income are settings, not impressions.
// No activity rows for either.

export async function updatePersonName(personId: Uuid, name: string) {
  const { error } = await createClient()
    .from("people")
    .update({ name })
    .eq("id", personId);
  if (error) throw error;
}

export async function updatePersonIncome(personId: Uuid, income: number) {
  const { error } = await createClient()
    .from("people")
    .update({ annual_income: Math.max(0, Math.round(income)) })
    .eq("id", personId);
  if (error) throw error;
}

// -- hook --------------------------------------------------------------------

/**
 * Postgres codes worth a sentence a person can act on. `23505` is a unique
 * violation, and the only unique constraints a person can hit by typing are
 * `people_name_lower` and the broker/listing names beside it.
 */
const PG_MESSAGES: Record<string, string> = {
  "23505": "That name is already taken.",
};

function field(error: unknown, key: string): string | null {
  if (error && typeof error === "object" && key in error) {
    const value = (error as Record<string, unknown>)[key];
    if (typeof value === "string" && value !== "") return value;
  }
  return null;
}

/**
 * React Query wrappers. Components use these; the bare functions above exist
 * for anything that needs to await a write outside a component.
 */
export function useMutations(personId: Uuid | undefined) {
  const qc = useQueryClient();

  const requirePerson = () => {
    if (!personId) throw new Error("No person selected");
    return personId;
  };

  const invalidateListings = (id?: Uuid) => {
    void qc.invalidateQueries({ queryKey: queryKeys.listings });
    if (id) void qc.invalidateQueries({ queryKey: queryKeys.listing(id) });
    void qc.invalidateQueries({ queryKey: queryKeys.activity });
  };

  const invalidateLocations = () => {
    void qc.invalidateQueries({ queryKey: queryKeys.locations });
    void qc.invalidateQueries({ queryKey: queryKeys.activity });
  };

  /**
   * Put a new (or newly re-addressed) listing on the map without making anybody
   * wait for it. Fire-and-forget on purpose: the add dialog navigates away
   * while this is still in flight and the pin arrives over realtime, exactly
   * like an imported photo. Only a *failure* is worth a word — and a quiet one,
   * since an address nobody can geocode is still a perfectly good listing.
   */
  const autoLocate = (listingId: Uuid) => {
    void (async () => {
      try {
        const located = await geocodeListing(listingId);
        invalidateListings(listingId);
        if (located.disabled || located.lat == null) return;
        // Free when there is nothing new to ask: the route skips every pair it
        // computed in the last 30 days.
        await computeCommutes({ listingId });
        invalidateListings(listingId);
      } catch (error) {
        toast.warning("Couldn't put that address on the map.", {
          description: field(error, "message") ?? undefined,
        });
      }
    })();
  };

  /**
   * `label` is the context ("Could not add the listing"), not the headline:
   * a raw `duplicate key value violates unique constraint "people_name_lower"`
   * as a toast title is a stack trace shown to a person. Known codes get a
   * sentence, everything else gets the generic with the driver's own message
   * underneath it, which is where it is useful rather than alarming.
   */
  const onError = (label: string) => (error: unknown) => {
    const code = field(error, "code");
    const known = code ? PG_MESSAGES[code] : undefined;
    if (known) {
      toast.error(known, { description: label });
      return;
    }
    toast.error("Something went wrong — try again.", {
      description: field(error, "message") ?? label,
    });
  };

  const create = useMutation({
    mutationFn: (input: NewListingInput) => createListing(requirePerson(), input),
    onSuccess: (listing) => {
      invalidateListings(listing.id);
      autoLocate(listing.id);
    },
    onError: onError("Could not add the listing"),
  });

  const update = useMutation({
    mutationFn: (vars: { id: Uuid; patch: ListingPatch; prev: Listing | null }) =>
      updateListing(requirePerson(), vars.id, vars.patch, vars.prev),
    onSuccess: (listing, vars) => {
      invalidateListings(listing.id);
      // The address moved, so a trigger has already thrown the old pin and the
      // old commute times away (0010). Go and get new ones.
      if (addressChanged(vars.patch, vars.prev)) autoLocate(listing.id);
    },
    onError: onError("Could not save the change"),
  });

  const status = useMutation({
    mutationFn: (vars: {
      listing: Pick<Listing, "id" | "address" | "unit" | "status">;
      status: ListingStatus;
    }) => setListingStatus(requirePerson(), vars.listing, vars.status),
    onSuccess: (listing) => invalidateListings(listing.id),
    onError: onError("Could not change the status"),
  });

  const linkState = useMutation({
    mutationFn: (vars: {
      listing: Pick<Listing, "id">;
      state: ListingState;
      note: string | null;
    }) => setListingState(requirePerson(), vars.listing, vars.state, vars.note),
    onSuccess: (listing) => invalidateListings(listing.id),
    onError: onError("Could not update the link status"),
  });

  /**
   * Owns its toast start to finish: a check is a fetch of somebody else's
   * website and can take several seconds, so a button that merely goes quiet
   * reads as broken. The same toast line turns into the answer.
   */
  const checkLink = useMutation<SyncResponse, unknown, Uuid, { toastId: string | number }>({
    mutationFn: (listingId) => checkListingNow(listingId),
    onMutate: () => ({ toastId: toast.loading("Looking at the listing page…") }),
    onSuccess: (result, listingId, ctx) => {
      const checked = result.checkedListing;
      if (result.disabled) {
        toast.error("Checking isn't configured on this deployment.", { id: ctx?.toastId });
      } else if (!checked) {
        toast.error("Couldn't check that listing.", { id: ctx?.toastId });
      } else if (checked.blocked) {
        toast.error("That site wouldn't let us look.", {
          id: ctx?.toastId,
          description: checked.note ?? undefined,
        });
      } else {
        const gone = checked.state === "off_market" || checked.state === "removed";
        toast.success(gone ? "Looks gone" : LINK_STATE_LABELS[checked.state], {
          id: ctx?.toastId,
          description: checked.note ?? undefined,
        });
      }
      invalidateListings(listingId);
    },
    onError: (error, _listingId, ctx) => {
      toast.error(field(error, "message") ?? "Couldn't check that listing.", {
        id: ctx?.toastId,
      });
    },
  });

  const merge = useMutation({
    mutationFn: (vars: { src: Pick<Listing, "id" | "address" | "unit">; dstId: Uuid }) =>
      mergeListings(requirePerson(), vars.src, vars.dstId),
    onSuccess: (_data, vars) => {
      invalidateListings(vars.dstId);
      void qc.invalidateQueries({ queryKey: queryKeys.listing(vars.src.id) });
    },
    onError: onError("Could not merge the listings"),
  });

  const mergeInto = useMutation({
    mutationFn: (vars: { existing: Listing; patch: ListingPatch }) =>
      mergeIntoExisting(requirePerson(), vars.existing, vars.patch),
    onSuccess: (listing) => invalidateListings(listing.id),
    onError: onError("Could not merge into the existing listing"),
  });

  const logContact = useMutation({
    mutationFn: (vars: {
      listing: Pick<Listing, "id" | "address" | "unit" | "status">;
      kind: InteractionKind;
      notes?: string | null;
    }) => logInteraction(requirePerson(), vars.listing, vars),
    onSuccess: (_interaction, vars) => {
      invalidateListings(vars.listing.id);
      void qc.invalidateQueries({ queryKey: queryKeys.interactions(vars.listing.id) });
    },
    onError: onError("Could not log the contact"),
  });

  const nextAction = useMutation({
    mutationFn: (vars: {
      listing: Pick<Listing, "id" | "address" | "unit">;
      nextAction: string;
      dueDate: DateOnly;
      ownerId: Uuid | null;
      ownerName?: string | null;
    }) => setNextAction(requirePerson(), vars.listing, vars),
    onSuccess: (listing) => invalidateListings(listing.id),
    onError: onError("Could not save the next action"),
  });

  const dropNextAction = useMutation({
    mutationFn: (listing: Pick<Listing, "id" | "address" | "unit">) =>
      clearNextAction(requirePerson(), listing),
    onSuccess: (listing) => invalidateListings(listing.id),
    onError: onError("Could not clear the next action"),
  });

  const sendMessage = useMutation({
    mutationFn: (input: PostMessageInput) => postMessage(requirePerson(), input),
    onSuccess: (_message, input) => {
      void qc.invalidateQueries({ queryKey: queryKeys.thread(input.listingId) });
      void qc.invalidateQueries({ queryKey: queryKeys.unread });
      void qc.invalidateQueries({ queryKey: queryKeys.activity });
    },
    onError: onError("Could not send the message"),
  });

  /**
   * Fired from an effect whenever a thread is on screen, so it is deliberately
   * quiet: no toast (nobody can act on "could not mark as read") and no
   * invalidation of the thread itself — reading changes the badge, not the
   * messages, and re-fetching here would put every open thread in a loop.
   */
  const readThread = useMutation({
    mutationFn: (listingId: Uuid | null) => markThreadRead(requirePerson(), listingId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.unread });
    },
    onError: (error) => console.error("thread read marker failed", error),
  });

  /**
   * Votes are the one write in the app that must feel instant: three buttons
   * that wait for a round trip feel broken. Both vote mutations patch the
   * embedded `votes` array on the listing row *and* on that row inside the
   * table's list, snapshot what they replaced, put it back on error and
   * invalidate on settle so the server's copy wins in the end.
   */
  type VoteSnapshot = {
    listing: ListingRow | null | undefined;
    listings: ListingRow[] | undefined;
  };

  const patchVotes = (listingId: Uuid, apply: (votes: VoteRow[]) => VoteRow[]) => {
    const patchRow = (row: ListingRow) =>
      row.id === listingId ? { ...row, votes: apply(row.votes ?? []) } : row;
    qc.setQueryData<ListingRow | null>(queryKeys.listing(listingId), (row) =>
      row ? patchRow(row) : row,
    );
    qc.setQueryData<ListingRow[]>(queryKeys.listings, (rows) => rows?.map(patchRow));
  };

  const startVote = async (
    listingId: Uuid,
    apply: (votes: VoteRow[]) => VoteRow[],
  ): Promise<VoteSnapshot> => {
    // `["listings"]` is a prefix of `["listings", id]`, so one cancel covers
    // both the table and the open detail page.
    await qc.cancelQueries({ queryKey: queryKeys.listings });
    const snapshot: VoteSnapshot = {
      listing: qc.getQueryData<ListingRow | null>(queryKeys.listing(listingId)),
      listings: qc.getQueryData<ListingRow[]>(queryKeys.listings),
    };
    patchVotes(listingId, apply);
    return snapshot;
  };

  const rollbackVote = (listingId: Uuid, snapshot: VoteSnapshot | undefined) => {
    if (!snapshot) return;
    if (snapshot.listing !== undefined) {
      qc.setQueryData(queryKeys.listing(listingId), snapshot.listing);
    }
    if (snapshot.listings !== undefined) {
      qc.setQueryData(queryKeys.listings, snapshot.listings);
    }
  };

  const vote = useMutation<Vote, unknown, CastVoteInput, VoteSnapshot | undefined>({
    mutationFn: (input) => castVote(requirePerson(), input),
    onMutate: async (input) => {
      if (!personId) return undefined;
      const optimistic: VoteRow = {
        person_id: personId,
        vote: input.vote,
        comment: input.comment?.trim() || null,
        updated_at: new Date().toISOString(),
      };
      return startVote(input.listing.id, (votes) => upsertVote(votes, optimistic));
    },
    onError: (error, input, snapshot) => {
      rollbackVote(input.listing.id, snapshot);
      onError("Could not save your vote")(error);
    },
    onSettled: (_data, _error, input) => invalidateListings(input.listing.id),
  });

  const dropVote = useMutation<
    void,
    unknown,
    Pick<Listing, "id" | "address" | "unit">,
    VoteSnapshot | undefined
  >({
    mutationFn: (listing) => clearVote(requirePerson(), listing),
    onMutate: async (listing) => {
      if (!personId) return undefined;
      return startVote(listing.id, (votes) => withoutVote(votes, personId));
    },
    onError: (error, listing, snapshot) => {
      rollbackVote(listing.id, snapshot);
      onError("Could not clear your vote")(error);
    },
    onSettled: (_data, _error, listing) => invalidateListings(listing.id),
  });

  const addBroker = useMutation({
    mutationFn: (input: Omit<NewBroker, "id">) => createBroker(requirePerson(), input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.brokers });
      void qc.invalidateQueries({ queryKey: queryKeys.activity });
    },
    onError: onError("Could not add the broker"),
  });

  const editBroker = useMutation({
    mutationFn: (vars: {
      id: Uuid;
      patch: Partial<Omit<Broker, "id" | "created_at">>;
    }) => updateBroker(requirePerson(), vars.id, vars.patch),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.brokers });
      void qc.invalidateQueries({ queryKey: queryKeys.listings });
    },
    onError: onError("Could not save the broker"),
  });

  /**
   * Photos own their toast from start to finish: uploading three pictures over
   * a phone connection takes long enough that a button which merely goes quiet
   * reads as broken. `onMutate` opens a loading toast with the count in it and
   * hands the id down, so the same line turns into the result rather than
   * stacking a second one under it.
   */
  const addPhotos = useMutation<
    SavePhotosResponse,
    unknown,
    { listingId: Uuid; files: File[] },
    { toastId: string | number }
  >({
    mutationFn: (vars) => uploadPhotos(personId ?? null, vars.listingId, vars.files),
    onMutate: (vars) => ({
      toastId: toast.loading(
        `Adding ${vars.files.length} ${vars.files.length === 1 ? "photo" : "photos"}…`,
      ),
    }),
    onSuccess: (result, vars, ctx) => {
      const saved = result.photos.length;
      const failed = result.failed.length;
      const description =
        failed > 0
          ? (result.failed[0]?.reason ?? `${failed} couldn't be added.`)
          : undefined;
      if (saved === 0) {
        toast.error("Couldn't add those photos.", { id: ctx?.toastId, description });
      } else {
        toast.success(`${saved} ${saved === 1 ? "photo" : "photos"} added`, {
          id: ctx?.toastId,
          description,
        });
      }
      invalidateListings(vars.listingId);
    },
    onError: (error, _vars, ctx) => {
      toast.error(field(error, "message") ?? "Couldn't add those photos.", {
        id: ctx?.toastId,
      });
    },
  });

  const removePhoto = useMutation({
    mutationFn: (vars: { photoId: Uuid; listingId: Uuid }) => deletePhoto(vars.photoId),
    onSuccess: (_data, vars) => {
      toast.success("Photo removed");
      invalidateListings(vars.listingId);
    },
    onError: (error) => {
      toast.error(field(error, "message") ?? "Couldn't remove that photo.");
    },
  });

  // -- locations & the map ---------------------------------------------------

  const addLocation = useMutation({
    mutationFn: (input: NewLocationInput) => createLocation(requirePerson(), input),
    onSuccess: (location) => {
      invalidateLocations();
      toast.success(`Added ${location.name}`);
      // A new place is the one moment the grid is genuinely empty for a whole
      // column, so this is the call that actually spends anything. It still
      // does not block the dialog closing.
      void computeCommutes({ locationId: location.id })
        .then(() => invalidateListings())
        .catch((error) => console.warn("commute backfill failed", error));
    },
    onError: onError("Could not add the location"),
  });

  const editLocation = useMutation({
    mutationFn: (vars: {
      id: Uuid;
      patch: Partial<Omit<Location, "id" | "created_at" | "added_by">>;
    }) => updateLocation(requirePerson(), vars.id, vars.patch),
    onSuccess: (location, vars) => {
      invalidateLocations();
      // Moved, not renamed: every cached time to this place was measured from
      // somewhere else. `force` is what makes the recompute ignore the 30-day
      // guard those rows are still inside.
      if (vars.patch.lat != null || vars.patch.lng != null) {
        void computeCommutes({ locationId: location.id, force: true })
          .then(() => invalidateListings())
          .catch((error) => console.warn("commute recompute failed", error));
      }
    },
    onError: onError("Could not save the location"),
  });

  const removeLocation = useMutation({
    mutationFn: (location: Pick<Location, "id" | "name">) =>
      deleteLocation(requirePerson(), location),
    onSuccess: (_data, location) => {
      invalidateLocations();
      // The cached times went with it (cascade), and they were embedded in
      // every listing row.
      invalidateListings();
      toast.success(`Removed ${location.name}`);
    },
    onError: onError("Could not remove the location"),
  });

  /**
   * The "Locate" button on a listing with no pin. Owns its toast start to
   * finish — two geocoders, one of them deliberately throttled, is long enough
   * that a button which merely goes quiet reads as broken.
   */
  const locate = useMutation<GeocodeResponse, unknown, Uuid, { toastId: string | number }>({
    mutationFn: (listingId) => geocodeListing(listingId),
    onMutate: () => ({ toastId: toast.loading("Looking that address up…") }),
    onSuccess: (result, listingId, ctx) => {
      if (result.disabled) {
        toast.error("Maps aren't configured on this deployment.", { id: ctx?.toastId });
      } else if (result.lat == null) {
        toast.error("Couldn't find that address.", {
          id: ctx?.toastId,
          description: result.error,
        });
      } else if (result.lowConfidence) {
        toast.warning("Found it, but check the pin.", {
          id: ctx?.toastId,
          description: "Drag it on the map if it's wrong.",
        });
      } else {
        toast.success("Found it", { id: ctx?.toastId });
      }
      invalidateListings(listingId);
      if (result.lat != null) {
        void computeCommutes({ listingId })
          .then(() => invalidateListings(listingId))
          .catch((error) => console.warn("commute backfill failed", error));
      }
    },
    onError: (error, _listingId, ctx) => {
      toast.error(field(error, "message") ?? "Couldn't find that address.", {
        id: ctx?.toastId,
      });
    },
  });

  /**
   * The locations dialog's on-blur preview: no row, no write and no toast —
   * the form shows the pin it found and the person decides whether to keep it.
   * A half-typed address failing is not news, so the failure only reaches the
   * console (and keeps the rejection handled).
   */
  const previewAddress = useMutation({
    mutationFn: (vars: { address: string; unit?: string | null }) =>
      geocodeAddressPreview(vars.address, vars.unit ?? null),
    onError: (error) => console.warn("address preview failed", error),
  });

  /** Drag-to-correct. The recompute is forced: the building actually moved. */
  const movePin = useMutation({
    mutationFn: (vars: {
      listing: Pick<Listing, "id" | "address" | "unit">;
      lat: number;
      lng: number;
    }) => setListingCoords(requirePerson(), vars.listing, vars.lat, vars.lng),
    onSuccess: (listing) => {
      invalidateListings(listing.id);
      void computeCommutes({ listingId: listing.id, force: true })
        .then(() => invalidateListings(listing.id))
        .catch((error) => console.warn("commute recompute failed", error));
    },
    onError: onError("Could not move the pin"),
  });

  /**
   * "Refresh times" on the detail card, and the batch behind "Locate all".
   * Reports what it did, because this is the one button in the app that spends
   * somebody's Google quota on purpose.
   */
  const refreshCommutes = useMutation<
    CommutesResponse,
    unknown,
    CommutesRequest,
    { toastId: string | number }
  >({
    mutationFn: (args) => computeCommutes(args),
    onMutate: () => ({ toastId: toast.loading("Working out the times…") }),
    onSuccess: (result, vars, ctx) => {
      if (result.disabled) {
        toast.error("Commute times aren't configured on this deployment.", {
          id: ctx?.toastId,
        });
      } else if (result.computed === 0) {
        toast.success("Already up to date", { id: ctx?.toastId });
      } else if (result.errors > 0) {
        toast.warning(`Updated ${result.computed - result.errors} of ${result.computed}`, {
          id: ctx?.toastId,
          description: result.rows.find((row) => row.error)?.error ?? undefined,
        });
      } else {
        toast.success(`Updated ${result.computed} times`, { id: ctx?.toastId });
      }
      invalidateListings(vars.listingId);
    },
    onError: (error, _vars, ctx) => {
      toast.error(field(error, "message") ?? "Couldn't work out the commute times.", {
        id: ctx?.toastId,
      });
    },
  });

  const renamePerson = useMutation({
    mutationFn: (name: string) => updatePersonName(requirePerson(), name),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.people });
      void qc.invalidateQueries({ queryKey: queryKeys.listings });
    },
    onError: onError("Could not save the name"),
  });

  const setIncome = useMutation({
    mutationFn: (vars: { personId: Uuid; income: number }) =>
      updatePersonIncome(vars.personId, vars.income),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.people });
    },
    onError: onError("Could not save the income"),
  });

  return {
    createListing: create,
    updateListing: update,
    setListingStatus: status,
    setListingState: linkState,
    checkListingNow: checkLink,
    mergeListings: merge,
    mergeIntoExisting: mergeInto,
    logInteraction: logContact,
    setNextAction: nextAction,
    clearNextAction: dropNextAction,
    postMessage: sendMessage,
    markThreadRead: readThread,
    castVote: vote,
    clearVote: dropVote,
    uploadPhotos: addPhotos,
    deletePhoto: removePhoto,
    createBroker: addBroker,
    updateBroker: editBroker,
    createLocation: addLocation,
    updateLocation: editLocation,
    deleteLocation: removeLocation,
    geocodeListing: locate,
    geocodeAddressPreview: previewAddress,
    setListingCoords: movePin,
    computeCommutes: refreshCommutes,
    updatePersonName: renamePerson,
    updatePersonIncome: setIncome,
  };
}
