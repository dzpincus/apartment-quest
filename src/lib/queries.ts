"use client";

/**
 * Read side of the data layer: one query-key factory, one fetcher per key,
 * thin `use*` hooks on top. Writes live in `mutations.ts` — nothing here
 * inserts or updates.
 */

import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { peopleQueryOptions } from "@/lib/person";
import type { Broker, Listing, Person, Uuid } from "@/lib/types";

/** Broker/person columns joined onto a listing row. */
export type ListingRow = Listing & {
  broker: Pick<Broker, "id" | "name" | "company" | "phone" | "email" | "notes"> | null;
  added_by_person: Pick<Person, "id" | "name" | "color"> | null;
};

/**
 * `!added_by` is a disambiguating hint: `listings` has two FKs to `people`
 * (`added_by` and `next_action_owner`), so PostgREST needs to be told which.
 */
const LISTING_SELECT = `
  *,
  broker:brokers(id, name, company, phone, email, notes),
  added_by_person:people!added_by(id, name, color)
`;

export const queryKeys = {
  people: ["people"] as const,
  brokers: ["brokers"] as const,
  listings: ["listings"] as const,
  listing: (id: Uuid) => ["listings", id] as const,
  listingByDedupeKey: (key: string) => ["listings", "dedupe", key] as const,
  activity: ["activity"] as const,
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
