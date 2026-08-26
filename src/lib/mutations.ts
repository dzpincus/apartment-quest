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
import { listingLabel, STATUS_LABELS } from "@/lib/format";
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
  ListingStatus,
  Message,
  NewBroker,
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
  broker_id: "broker",
  added_by: "added by",
  status: "status",
  merged_into: "merge",
};

function blank(v: unknown) {
  return v === null || v === undefined || v === "";
}

/**
 * "Nothing to say" for the merge backfill. `pets` defaults to `'unknown'`,
 * which is an absence wearing a value's clothes: a plain `blank()` check would
 * read the default as an answer, refuse to fill it from the duplicate, and
 * happily overwrite a real answer with it. Mirrors the `case` in
 * `merge_listings` (0005) — change one and change the other.
 */
function blankForMerge(column: string, v: unknown) {
  return blank(v) || (column === "pets" && v === "unknown");
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
    onSuccess: (listing) => invalidateListings(listing.id),
    onError: onError("Could not add the listing"),
  });

  const update = useMutation({
    mutationFn: (vars: { id: Uuid; patch: ListingPatch; prev: Listing | null }) =>
      updateListing(requirePerson(), vars.id, vars.patch, vars.prev),
    onSuccess: (listing) => invalidateListings(listing.id),
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
    mergeListings: merge,
    mergeIntoExisting: mergeInto,
    logInteraction: logContact,
    setNextAction: nextAction,
    clearNextAction: dropNextAction,
    postMessage: sendMessage,
    markThreadRead: readThread,
    castVote: vote,
    clearVote: dropVote,
    createBroker: addBroker,
    updateBroker: editBroker,
    updatePersonName: renamePerson,
    updatePersonIncome: setIncome,
  };
}
