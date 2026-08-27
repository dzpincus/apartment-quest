/**
 * "Look at this one!" — the pure half.
 *
 * A spotlight (0012) is one listing per person, promoted to Home with a reason
 * the other three can read. The table's primary key is `person_id`, so the
 * "one" is enforced by the database and not by anything here; what *is* decided
 * here is which spotlights are still worth drawing, which listing is mine, and
 * what the activity feed says about either.
 *
 * Spotlights ride along on the listing row (`LISTING_SELECT` embeds them), so
 * every helper takes rows rather than fetching anything. No React, no Supabase
 * — all of it is unit-tested in `spotlight.test.ts`.
 */

import { isBot } from "@/lib/people";
import type { ListingRow } from "@/lib/queries";
import type { ListingStatus, Timestamptz, Uuid } from "@/lib/types";

/**
 * How much "why" a person gets. A shout across a room, not an essay — and a
 * limit somebody can see themselves approaching belongs in the input, which is
 * why it lives here and not as a CHECK constraint in 0012.
 */
export const SPOTLIGHT_NOTE_MAX = 280;

/**
 * How much of the note the *feed* repeats. The card on Home prints the whole
 * thing; a line in "Lately" is one row among fifty and must not become a
 * paragraph.
 */
export const SUMMARY_NOTE_MAX = 80;

/**
 * A listing is out of the running once it is merged away or somebody decided
 * against it. Nothing is deleted for either — see `activeSpotlights`.
 */
const DEAD_STATUSES: ReadonlySet<ListingStatus> = new Set<ListingStatus>([
  "passed",
  "lost",
]);

/** The columns a row needs to carry to be considered. */
export type SpotlightSource = Pick<
  ListingRow,
  "id" | "status" | "merged_into" | "spotlights"
>;

/** The columns a person needs to carry. `key` is how the bot is spotted. */
export type SpotlightPerson = { id: Uuid; key?: string | null };

export type ActiveSpotlight<P, R> = {
  person: P;
  listing: R;
  note: string | null;
  created_at: Timestamptz;
};

/** Milliseconds, or 0 for anything unparseable — never NaN into a comparator. */
function at(value: Timestamptz | null | undefined): number {
  if (!value) return 0;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * Every spotlight worth drawing on Home, newest first.
 *
 * Three things drop out, all of them at *read* time rather than by deleting a
 * row:
 *
 * - a listing that was merged into another (`merged_into`), because the
 *   surviving row is where everything about that apartment lives now — note
 *   that `useListings()` has already filtered these, so this is the belt to
 *   `merge_listings`' braces;
 * - a listing somebody marked `passed` or `lost` — "look at this one" about an
 *   apartment the house has given up on is noise, and un-passing it brings the
 *   spotlight straight back, which is what somebody who mis-tapped Passed
 *   actually wants;
 * - Quest Bot, which has never been in an apartment and has no opinions.
 *
 * At most one entry per person even if the data somehow disagrees: the newest
 * wins, ties broken on person id so the order is stable between renders rather
 * than dependent on which listing the fetcher happened to return first.
 */
export function activeSpotlights<P extends SpotlightPerson, R extends SpotlightSource>(
  rows: readonly R[] | null | undefined,
  people: readonly P[] | null | undefined,
): Array<ActiveSpotlight<P, R>> {
  const roster = new Map<Uuid, P>();
  for (const person of people ?? []) {
    if (!isBot(person)) roster.set(person.id, person);
  }
  if (roster.size === 0) return [];

  const best = new Map<Uuid, ActiveSpotlight<P, R>>();
  for (const listing of rows ?? []) {
    if (listing.merged_into) continue;
    if (listing.status && DEAD_STATUSES.has(listing.status)) continue;
    for (const spotlight of listing.spotlights ?? []) {
      const person = roster.get(spotlight.person_id);
      if (!person) continue;
      const entry: ActiveSpotlight<P, R> = {
        person,
        listing,
        note: spotlight.note?.trim() || null,
        created_at: spotlight.created_at,
      };
      const held = best.get(person.id);
      if (!held || at(entry.created_at) > at(held.created_at)) best.set(person.id, entry);
    }
  }

  return [...best.values()].sort(
    (a, b) =>
      at(b.created_at) - at(a.created_at) || a.person.id.localeCompare(b.person.id),
  );
}

/**
 * This person's spotlight — the row it is on and the note under it — or null.
 *
 * Deliberately *not* filtered the way `activeSpotlights` is: a spotlight on a
 * listing the house has passed on still occupies the one slot this person has,
 * so the dialog has to be able to say "this replaces your spotlight on X" and
 * offer to take it down. Home hides it; the person who set it should not have
 * to guess where it went.
 */
export function mySpotlight<R extends SpotlightSource>(
  rows: readonly R[] | null | undefined,
  personId: Uuid | null | undefined,
): { listing: R; note: string | null } | null {
  if (!personId) return null;
  for (const listing of rows ?? []) {
    const mine = (listing.spotlights ?? []).find((s) => s.person_id === personId);
    if (mine) return { listing, note: mine.note?.trim() || null };
  }
  return null;
}

/**
 * The note as the feed repeats it: trimmed, in curly quotes, and cut at
 * `SUMMARY_NOTE_MAX` with an ellipsis. The cut is inclusive of the ellipsis, so
 * the quoted text is never longer than the cap it names.
 */
function quoted(note: string): string {
  const trimmed = note.trim();
  const short =
    trimmed.length <= SUMMARY_NOTE_MAX
      ? trimmed
      : `${trimmed.slice(0, SUMMARY_NOTE_MAX - 1).trimEnd()}…`;
  return `“${short}”`;
}

/**
 * The feed line for a spotlight write. A verb phrase with no actor's name — the
 * feed prints the person in their own colour, so "Dylan spotlighted" would say
 * it twice.
 *
 * The note goes in because the whole point of the feature is the reason: a feed
 * that says only "spotlighted 214 Grand St #4B" makes somebody open a listing
 * to find out why they were asked to.
 */
export function spotlightSummary(
  action: "set" | "clear",
  label: string,
  note: string | null | undefined,
): string {
  if (action === "clear") return `took the spotlight off ${label}`;
  const trimmed = note?.trim();
  return trimmed ? `spotlighted ${label} — ${quoted(trimmed)}` : `spotlighted ${label}`;
}
