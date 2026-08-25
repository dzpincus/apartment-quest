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
 * - Phase 3: `logInteraction` (logged_interaction), `setNextAction`
 *   (set_next_action) — both also bump `listings.last_contacted_at` /
 *   `next_action*`, which is exactly why those columns are excluded from the
 *   `edited_listing` diff below.
 * - Phase 4: `postMessage` (messaged) + thread read markers.
 * - Phase 5: `castVote` (voted).
 * - Phase 6 (if ever): `setDocumentStatus` (updated_document).
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { queryKeys } from "@/lib/queries";
import { listingLabel, STATUS_LABELS } from "@/lib/format";
import type {
  ActivityVerb,
  Broker,
  EntityType,
  Listing,
  ListingStatus,
  NewBroker,
  Uuid,
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
  broker_id: "broker",
  added_by: "added by",
  status: "status",
  merged_into: "merge",
};

function blank(v: unknown) {
  return v === null || v === undefined || v === "";
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

export async function setListingStatus(
  personId: Uuid,
  listing: Pick<Listing, "id" | "address" | "unit" | "status">,
  status: ListingStatus,
): Promise<Listing> {
  const { data, error } = await createClient()
    .from("listings")
    .update({ status })
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
    if (blank(v) || NOISY_COLUMNS.has(k)) continue;
    if (blank((existing as unknown as Record<string, unknown>)[k])) {
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

function errorMessage(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message) || fallback;
  }
  return fallback;
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

  const onError = (label: string) => (error: unknown) => {
    toast.error(errorMessage(error, label));
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
    createBroker: addBroker,
    updateBroker: editBroker,
    updatePersonName: renamePerson,
    updatePersonIncome: setIncome,
  };
}
