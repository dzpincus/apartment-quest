"use client";

/**
 * Read side of the data layer: one query-key factory, one fetcher per key,
 * thin `use*` hooks on top. Writes live in `mutations.ts` — nothing here
 * inserts or updates.
 */

import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { peopleQueryOptions } from "@/lib/person";
import type {
  Activity,
  Broker,
  Interaction,
  Listing,
  Person,
  Uuid,
} from "@/lib/types";

/** The person columns every joined row carries. */
export type PersonRef = Pick<Person, "id" | "name" | "color">;

/** Broker/person columns joined onto a listing row. */
export type ListingRow = Listing & {
  broker: Pick<Broker, "id" | "name" | "company" | "phone" | "email" | "notes"> | null;
  added_by_person: PersonRef | null;
  next_action_owner_person: PersonRef | null;
};

export type ActivityRow = Activity & { person: PersonRef | null };

export type InteractionRow = Interaction & { person: PersonRef | null };

/**
 * `!added_by` / `!next_action_owner` are disambiguating hints: `listings` has
 * two FKs to `people`, so PostgREST needs to be told which one each embed
 * follows. The owner join is on every listing read rather than a queue-only
 * select — one extra join against a four-row table is cheaper than a second
 * cache entry that can disagree with the first.
 */
const LISTING_SELECT = `
  *,
  broker:brokers(id, name, company, phone, email, notes),
  added_by_person:people!added_by(id, name, color),
  next_action_owner_person:people!next_action_owner(id, name, color)
`;

export const queryKeys = {
  people: ["people"] as const,
  brokers: ["brokers"] as const,
  listings: ["listings"] as const,
  listing: (id: Uuid) => ["listings", id] as const,
  listingByDedupeKey: (key: string) => ["listings", "dedupe", key] as const,
  activity: ["activity"] as const,
  activityFeed: (limit: number) => ["activity", limit] as const,
  interactions: (listingId: Uuid) => ["interactions", listingId] as const,
};

export async function fetchPeople(): Promise<Person[]> {
  const { data, error } = await createClient()
    .from("people")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Person[];
}

export async function fetchBrokers(): Promise<Broker[]> {
  const { data, error } = await createClient()
    .from("brokers")
    .select("*")
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Broker[];
}

/** Live listings only — merged rows are never shown anywhere. */
export async function fetchListings(): Promise<ListingRow[]> {
  const { data, error } = await createClient()
    .from("listings")
    .select(LISTING_SELECT)
    .is("merged_into", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as ListingRow[];
}

/** By id, including merged rows — the detail page shows a "merged into" banner. */
export async function fetchListing(id: Uuid): Promise<ListingRow | null> {
  const { data, error } = await createClient()
    .from("listings")
    .select(LISTING_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as ListingRow) ?? null;
}

/** Dedupe check for the add form. Returns the live row with this key, if any. */
export async function fetchListingByDedupeKey(
  key: string,
): Promise<ListingRow | null> {
  const { data, error } = await createClient()
    .from("listings")
    .select(LISTING_SELECT)
    .eq("dedupe_key", key)
    .is("merged_into", null)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as ListingRow) ?? null;
}

/** Reverse-chronological feed, pre-rendered summaries (SPEC: "Activity tracking"). */
export async function fetchActivity(limit: number): Promise<ActivityRow[]> {
  const { data, error } = await createClient()
    .from("activity")
    .select("*, person:people!person_id(id, name, color)")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as ActivityRow[];
}

/** One listing's contact history, newest first. */
export async function fetchInteractions(listingId: Uuid): Promise<InteractionRow[]> {
  const { data, error } = await createClient()
    .from("interactions")
    .select("*, person:people!person_id(id, name, color)")
    .eq("listing_id", listingId)
    .order("occurred_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as InteractionRow[];
}

export function usePeople() {
  return useQuery(peopleQueryOptions());
}

export function useBrokers() {
  return useQuery({
    queryKey: queryKeys.brokers,
    queryFn: fetchBrokers,
  });
}

export function useListings() {
  return useQuery({
    queryKey: queryKeys.listings,
    queryFn: fetchListings,
  });
}

/**
 * The follow-up queue reads exactly the rows the listings table already has —
 * same key, same cache entry — and buckets them client-side with
 * `bucketListings`. Keeping one cache entry means the nav badge, the home
 * screen and the table can never disagree, and the badge costs no extra
 * request.
 */
export function useQueueListings() {
  return useQuery({
    queryKey: queryKeys.listings,
    queryFn: fetchListings,
    refetchOnWindowFocus: true,
  });
}

export function useActivity(limit = 50) {
  return useQuery({
    queryKey: queryKeys.activityFeed(limit),
    queryFn: () => fetchActivity(limit),
    refetchOnWindowFocus: true,
  });
}

export function useInteractions(listingId: Uuid | undefined) {
  return useQuery({
    queryKey: queryKeys.interactions(listingId ?? "none"),
    queryFn: () => fetchInteractions(listingId as Uuid),
    enabled: Boolean(listingId),
  });
}

export function useListing(id: Uuid | undefined) {
  return useQuery({
    queryKey: queryKeys.listing(id ?? "none"),
    queryFn: () => fetchListing(id as Uuid),
    enabled: Boolean(id),
  });
}

/**
 * Dedupe lookup, off by default: the add form enables it once an address has
 * been typed. `key` of `"|"` (empty address and unit) is never enabled.
 */
export function useListingByDedupeKey(
  key: string,
  options?: Pick<UseQueryOptions<ListingRow | null>, "enabled">,
) {
  return useQuery({
    queryKey: queryKeys.listingByDedupeKey(key),
    queryFn: () => fetchListingByDedupeKey(key),
    enabled: (options?.enabled ?? true) && key.replace(/\|/g, "").length > 0,
    staleTime: 0,
  });
}
