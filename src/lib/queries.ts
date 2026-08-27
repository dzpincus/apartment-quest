"use client";

/**
 * Read side of the data layer: one query-key factory, one fetcher per key,
 * thin `use*` hooks on top. Writes live in `mutations.ts` — nothing here
 * inserts or updates.
 */

import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { peopleQueryOptions, usePerson } from "@/lib/person";
import type {
  Activity,
  Broker,
  CommuteMode,
  CommuteTime,
  Interaction,
  Listing,
  ListingPhoto,
  Location,
  Message,
  Person,
  UnreadCount,
  Uuid,
  Vote,
} from "@/lib/types";

/** The person columns every joined row carries. */
export type PersonRef = Pick<Person, "id" | "name" | "color">;

/**
 * A vote as it arrives embedded in a listing. `listing_id` is left off — it is
 * the row you found it on — and the person is resolved from `usePerson().people`
 * rather than joined again for four rows the client already holds.
 */
export type VoteRow = Pick<Vote, "person_id" | "vote" | "comment" | "updated_at">;

/**
 * A photo as it arrives embedded in a listing. `listing_id` is left off — it is
 * the row you found it on — and the provenance columns (`source_url`, `bytes`,
 * `added_by`, `created_at`) are not selected: nothing on screen shows them, and
 * every listing read carries this array.
 */
export type PhotoRef = Pick<
  ListingPhoto,
  "id" | "storage_path" | "thumb_path" | "width" | "height" | "sort"
>;

/**
 * A cached commute as it arrives embedded in a listing (0010). `listing_id` is
 * left off — it is the row you found it on — and `computed_at` is not selected:
 * nothing on screen shows it, the 30-day guard is enforced server-side by
 * `/api/commutes`, and this array rides along on every listing read.
 */
export type CommuteRef = Pick<
  CommuteTime,
  "location_id" | "mode" | "seconds" | "meters" | "error"
>;

/** Broker/person columns joined onto a listing row, plus everyone's votes. */
export type ListingRow = Listing & {
  broker: Pick<Broker, "id" | "name" | "company" | "phone" | "email" | "notes"> | null;
  added_by_person: PersonRef | null;
  next_action_owner_person: PersonRef | null;
  votes: VoteRow[];
  photos: PhotoRef[];
  commute_times: CommuteRef[];
};

export type ActivityRow = Activity & { person: PersonRef | null };

export type InteractionRow = Interaction & { person: PersonRef | null };

export type MessageRow = Message & { person: PersonRef | null };

/**
 * `unread_counts` flattened for the badges: the global thread, a per-listing
 * map, and the sum. One RPC feeds the nav badge, the listings table and the
 * listing detail heading.
 */
export type UnreadSummary = {
  global: number;
  byListing: Record<Uuid, number>;
  total: number;
};

export const EMPTY_UNREAD: UnreadSummary = { global: 0, byListing: {}, total: 0 };

/**
 * `!added_by` / `!next_action_owner` are disambiguating hints: `listings` has
 * two FKs to `people`, so PostgREST needs to be told which one each embed
 * follows. The owner join is on every listing read rather than a queue-only
 * select — one extra join against a four-row table is cheaper than a second
 * cache entry that can disagree with the first.
 *
 * Votes are embedded for the same reason: the table's chips, the cards and the
 * detail widget all want them, and four rows per listing on a query that
 * already runs is cheaper than one vote query per visible listing.
 *
 * Photos ride along too, and the table and cards use only the first one. The
 * embed is ordered client-side by `sortPhotos` rather than with PostgREST's
 * `order` modifier: a merge can leave two photos sharing a `sort` (0007), and
 * `(sort, id)` is the tie-break that keeps the strip from reshuffling itself
 * between refetches.
 *
 * Commute times (0010) ride along for the third time on the same argument: the
 * table's "Transit to ⭐" column, the map's mini card and the detail page's
 * "Getting there" card all want them, and fifteen small rows on a query that
 * already runs is cheaper than one commute query per visible listing.
 */
const LISTING_SELECT = `
  *,
  broker:brokers(id, name, company, phone, email, notes),
  added_by_person:people!added_by(id, name, color),
  next_action_owner_person:people!next_action_owner(id, name, color),
  votes(person_id, vote, comment, updated_at),
  photos:listing_photos(id, storage_path, thumb_path, width, height, sort),
  commute_times(location_id, mode, seconds, meters, error)
`;

/**
 * Photo order: `sort` ascending, id as the tie-break. Pure and total — a row
 * that somehow arrives without its embed reads as "no photos" rather than
 * throwing halfway down a listing page.
 */
export function sortPhotos(photos: PhotoRef[] | null | undefined): PhotoRef[] {
  if (!photos || photos.length === 0) return [];
  return [...photos].sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id));
}

/** Every listing that leaves this module has its photos in order. */
function withSortedPhotos<T extends { photos?: PhotoRef[] | null }>(row: T): T {
  return { ...row, photos: sortPhotos(row.photos) };
}

export const queryKeys = {
  people: ["people"] as const,
  brokers: ["brokers"] as const,
  /** The shared saved places (0010). Per-device visibility is `prefs.ts`. */
  locations: ["locations"] as const,
  listings: ["listings"] as const,
  listing: (id: Uuid) => ["listings", id] as const,
  listingByDedupeKey: (key: string) => ["listings", "dedupe", key] as const,
  activity: ["activity"] as const,
  activityFeed: (limit: number) => ["activity", limit] as const,
  interactions: (listingId: Uuid) => ["interactions", listingId] as const,
  /** Prefix — invalidate to refresh every thread at once. */
  messages: ["messages"] as const,
  /** One thread. `null` is the global thread, stored under `"global"`. */
  thread: (listingId: Uuid | null) => ["messages", listingId ?? "global"] as const,
  /** Prefix — the badges are per person, but every write invalidates all of it. */
  unread: ["unread"] as const,
  unreadFor: (personId: Uuid) => ["unread", personId] as const,
  /**
   * Votes have no cache entry of their own — they ride on the listing row and
   * `useVotes` reads them from `listing(id)`. The key stays because realtime
   * invalidates it on any `votes` change; the same handler also invalidates
   * `listings`, which is a *prefix* of `listing(id)` and so refreshes both the
   * table and whichever detail page is open.
   */
  votes: (listingId: Uuid) => ["votes", listingId] as const,
};

/** How much scrollback a thread keeps. Four people, a few weeks — plenty. */
export const THREAD_LIMIT = 200;

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
  return ((data ?? []) as unknown as ListingRow[]).map(withSortedPhotos);
}

/** By id, including merged rows — the detail page shows a "merged into" banner. */
export async function fetchListing(id: Uuid): Promise<ListingRow | null> {
  const { data, error } = await createClient()
    .from("listings")
    .select(LISTING_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? withSortedPhotos(data as unknown as ListingRow) : null;
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
  return data ? withSortedPhotos(data as unknown as ListingRow) : null;
}

/** The saved places, oldest first — the order they were added in. */
export async function fetchLocations(): Promise<Location[]> {
  const { data, error } = await createClient()
    .from("locations")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Location[];
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

/**
 * One thread, oldest first. `listingId === null` is the global thread — note
 * `.is("listing_id", null)`, since `.eq(..., null)` is not the same query.
 *
 * The *last* `THREAD_LIMIT` messages, so the fetch is newest-first and reversed
 * here: `ascending: true` with a limit would hand back the oldest 200 and the
 * thread would freeze on the day it was created.
 */
export async function fetchMessages(listingId: Uuid | null): Promise<MessageRow[]> {
  const base = createClient()
    .from("messages")
    .select("*, person:people!person_id(id, name, color)");
  const scoped =
    listingId === null ? base.is("listing_id", null) : base.eq("listing_id", listingId);
  const { data, error } = await scoped
    .order("created_at", { ascending: false })
    .limit(THREAD_LIMIT);
  if (error) throw error;
  return ((data ?? []) as unknown as MessageRow[]).slice().reverse();
}

/** Unread badges for every thread in one round trip (`unread_counts` RPC). */
export async function fetchUnreadCounts(personId: Uuid): Promise<UnreadSummary> {
  const { data, error } = await createClient().rpc("unread_counts", {
    p_person: personId,
  });
  if (error) throw error;
  const summary: UnreadSummary = { global: 0, byListing: {}, total: 0 };
  for (const row of (data ?? []) as UnreadCount[]) {
    // bigint comes back as a string on some PostgREST versions.
    const n = Number(row.unread) || 0;
    if (row.listing_id === null) summary.global += n;
    else summary.byListing[row.listing_id] = n;
    summary.total += n;
  }
  return summary;
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

/**
 * Every saved place. Shared data, so there is one cache entry for all four
 * people; `src/lib/prefs.ts` decides which of them *this device* draws.
 */
export function useLocations() {
  return useQuery({
    queryKey: queryKeys.locations,
    queryFn: fetchLocations,
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
 * The four votes on one listing. Same key and same fetcher as `useListing` —
 * `select` runs per observer, so this is a view of that one cache entry, not a
 * second request. Optimistic writes patch the listing row and both update.
 */
export function useVotes(id: Uuid | undefined) {
  return useQuery({
    queryKey: queryKeys.listing(id ?? "none"),
    queryFn: () => fetchListing(id as Uuid),
    enabled: Boolean(id),
    select: (listing: ListingRow | null) => listing?.votes ?? [],
  });
}

/**
 * One listing's cached commute times, keyed by `location_id` and mode. Same key
 * and same fetcher as `useListing`, so this is a view of that one cache entry
 * rather than a second request — exactly like `useVotes`.
 *
 * A missing pair is a missing entry, not a zero: the card shows "—" and offers
 * "Refresh times", which is the only thing that spends money.
 */
export function useCommutes(listingId: Uuid | undefined) {
  return useQuery({
    queryKey: queryKeys.listing(listingId ?? "none"),
    queryFn: () => fetchListing(listingId as Uuid),
    enabled: Boolean(listingId),
    select: (listing: ListingRow | null) => listing?.commute_times ?? [],
  });
}

/**
 * `commute_times` as a lookup: `byLocation.get(locationId)?.get(mode)`. Pure,
 * so the commute card and the table column share one shape and neither has to
 * scan an array per cell.
 */
export function commuteIndex(
  rows: readonly CommuteRef[] | null | undefined,
): Map<Uuid, Map<CommuteMode, CommuteRef>> {
  const index = new Map<Uuid, Map<CommuteMode, CommuteRef>>();
  for (const row of rows ?? []) {
    const modes = index.get(row.location_id) ?? new Map<CommuteMode, CommuteRef>();
    modes.set(row.mode, row);
    index.set(row.location_id, modes);
  }
  return index;
}

/**
 * A thread's messages. Kept fresh by the realtime channel rather than by
 * polling — `staleTime: 0` so a tab that reconnects picks up what it missed.
 */
export function useMessages(listingId: Uuid | null) {
  return useQuery({
    queryKey: queryKeys.thread(listingId),
    queryFn: () => fetchMessages(listingId),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

/**
 * Unread counts for the person on this device. Keyed by person so switching
 * who you are cannot show someone else's badges; every write invalidates the
 * `["unread"]` prefix, which covers both.
 */
export function useUnreadCounts() {
  const { person } = usePerson();
  return useQuery({
    queryKey: queryKeys.unreadFor(person?.id ?? "none"),
    queryFn: () => fetchUnreadCounts(person!.id),
    enabled: Boolean(person),
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

/** Badge-friendly view of `useUnreadCounts` — zeros until it loads. */
export function useUnread(): UnreadSummary {
  return useUnreadCounts().data ?? EMPTY_UNREAD;
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
