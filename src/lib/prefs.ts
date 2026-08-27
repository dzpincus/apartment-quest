"use client";

/**
 * Per-device, per-person preferences about the map.
 *
 * Saved places are shared data (`locations`, 0010) — one hunt, one list — but
 * *which* of them a given person wants to see, and which one they want in the
 * table's starred column, is not something the other three should be able to
 * change from across the room. There are four people and no settings table
 * (SPEC), so these live in `localStorage` and never leave the device:
 *
 *   aq.locations.hidden:<personId>    JSON array of location ids to hide
 *   aq.locations.primary:<personId>   one location id, or absent
 *
 * The store pattern is `src/lib/person.tsx`'s: `useSyncExternalStore` over
 * localStorage, so React reads it without a setState-in-an-effect and two
 * components showing the same chip row agree. Every read is guarded for the
 * server (`typeof window === "undefined"`), which is what makes these hooks
 * safe inside a component that also renders during SSR.
 */

import { useCallback, useSyncExternalStore } from "react";
import type { Uuid } from "@/lib/types";

export const hiddenKey = (personId: Uuid) => `aq.locations.hidden:${personId}`;
export const primaryKey = (personId: Uuid) => `aq.locations.primary:${personId}`;

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  // `storage` fires in *other* tabs, `listeners` covers this one.
  if (typeof window !== "undefined") window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    if (typeof window !== "undefined") window.removeEventListener("storage", onChange);
  };
}

function read(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Safari in private mode throws on access, and a preference is never worth
    // taking the page down for.
    return null;
  }
}

function write(key: string, value: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    return;
  }
  emit();
}

const EMPTY: ReadonlySet<Uuid> = new Set<Uuid>();

/**
 * `useSyncExternalStore` compares snapshots by identity and re-renders forever
 * if a fresh Set comes back every time it looks. So the parsed value is cached
 * against the exact string it was parsed from, and only a real change to the
 * stored text produces a new object.
 */
const parsed = new Map<string, { raw: string | null; value: ReadonlySet<Uuid> }>();

function hiddenSnapshot(personId: Uuid): ReadonlySet<Uuid> {
  const key = hiddenKey(personId);
  const raw = read(key);
  const cached = parsed.get(key);
  if (cached && cached.raw === raw) return cached.value;
  const value = raw ? toIdSet(raw) : EMPTY;
  parsed.set(key, { raw, value });
  return value;
}

function toIdSet(raw: string): ReadonlySet<Uuid> {
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return EMPTY;
    const ids = list.filter((id): id is string => typeof id === "string");
    return ids.length > 0 ? new Set(ids) : EMPTY;
  } catch {
    return EMPTY;
  }
}

/** The location ids this person has switched off on this device. */
export function hiddenLocationIds(personId: Uuid): ReadonlySet<Uuid> {
  return hiddenSnapshot(personId);
}

/** Switch one place off, or back on. Returns the new set. */
export function toggleLocationHidden(personId: Uuid, locationId: Uuid): ReadonlySet<Uuid> {
  const next = new Set(hiddenSnapshot(personId));
  if (next.has(locationId)) next.delete(locationId);
  else next.add(locationId);
  write(hiddenKey(personId), next.size > 0 ? JSON.stringify([...next]) : null);
  return next;
}

/** Explicit set, for a "show all" / "hide all" control. */
export function setLocationHidden(
  personId: Uuid,
  locationId: Uuid,
  hidden: boolean,
): ReadonlySet<Uuid> {
  const current = hiddenSnapshot(personId);
  if (current.has(locationId) === hidden) return current;
  return toggleLocationHidden(personId, locationId);
}

/** The place this person's starred column measures to, if they picked one. */
export function primaryLocationId(personId: Uuid): Uuid | null {
  return read(primaryKey(personId));
}

/** Star a place, or `null` to clear. Starring the starred one clears it. */
export function setPrimaryLocation(personId: Uuid, locationId: Uuid | null): void {
  const current = primaryLocationId(personId);
  write(primaryKey(personId), locationId && locationId !== current ? locationId : null);
}

/**
 * The hidden set, live. Re-renders when this tab toggles one *and* when another
 * tab does. Returns an empty set on the server and on the first paint, so the
 * map draws every location rather than none while hydrating.
 */
export function useHiddenLocationIds(personId: Uuid | undefined): ReadonlySet<Uuid> {
  const getSnapshot = useCallback(
    () => (personId ? hiddenSnapshot(personId) : EMPTY),
    [personId],
  );
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
}

/** Either shape a caller already has to hand: the rows, or just their ids. */
export type KnownLocations = readonly Uuid[] | readonly { id: Uuid }[];

const idOf = (item: Uuid | { id: Uuid }): Uuid => (typeof item === "string" ? item : item.id);

/**
 * The starred place, live. Null until a person picks one.
 *
 * `knownIds` is the loaded list, and passing it is what keeps a stale
 * preference from becoming a broken column. localStorage outlives the row it
 * names: anybody can delete a saved place — one hunt, one list — and the three
 * other devices carry on starring an id that no longer exists. The table then
 * grows a "Transit to ⭐" column of em dashes it can never fill, the sort key
 * reads every listing as null, and the mobile cards hide a chip for a place
 * with no name. Omit the argument and the raw stored value comes back, which
 * is right for a caller that has not loaded the list yet.
 */
export function usePrimaryLocationId(
  personId: Uuid | undefined,
  knownIds?: KnownLocations,
): Uuid | null {
  const getSnapshot = useCallback(() => {
    if (!personId) return null;
    const starred = primaryLocationId(personId);
    if (starred === null || knownIds === undefined) return starred;
    return knownIds.some((item) => idOf(item) === starred) ? starred : null;
  }, [personId, knownIds]);
  // The snapshot is a string or null — a primitive, so an unstable `knownIds`
  // identity costs a comparison and never an extra render.
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}

/**
 * `[visible, toggle]` for a chip row: the ids to draw, given the shared list
 * this device has an opinion about. Pure so the map and the commute card can
 * both use it without either owning the filter.
 */
export function visibleLocations<T extends { id: Uuid }>(
  locations: readonly T[] | undefined,
  hidden: ReadonlySet<Uuid>,
): T[] {
  return (locations ?? []).filter((location) => !hidden.has(location.id));
}

// -- how the listings page is shown ------------------------------------------

/**
 * List or map, per device. Not a URL parameter and not React state: a person
 * who thinks in pins should get pins on Tuesday too, and a shared link should
 * open in whatever *the reader* prefers.
 *
 * Same guarded read as the toggles above — a browser that refuses localStorage
 * gets the list, which is the mode that works without a network.
 */
export const LISTINGS_VIEW_KEY = "aq.listingsView";

export type ListingsView = "list" | "map";

const isView = (raw: string | null): raw is ListingsView =>
  raw === "list" || raw === "map";

export function listingsView(): ListingsView {
  const raw = read(LISTINGS_VIEW_KEY);
  return isView(raw) ? raw : "list";
}

export function setListingsView(view: ListingsView): void {
  write(LISTINGS_VIEW_KEY, view === "list" ? null : view);
}

/**
 * `[view, setView]`, live across tabs. The server snapshot is `"list"`: the
 * map is a client-only component behind `next/dynamic`, and rendering the
 * toolbar as if it were already open would flash the wrong control.
 */
export function useListingsView(): [ListingsView, (view: ListingsView) => void] {
  const view = useSyncExternalStore(subscribe, listingsView, () => "list" as const);
  const set = useCallback((next: ListingsView) => setListingsView(next), []);
  return [view, set];
}
