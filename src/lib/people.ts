/**
 * Who counts as a housemate.
 *
 * `people` stopped being "the four of us" in 0006: the sync run needs a row to
 * sign its activity with, because `activity.person_id` is NOT NULL, so
 * `('bot', 'Quest Bot')` sits in the same table as Dylan, Reese, Brenna and
 * Kathryn. Everywhere the app means *a person* — the picker, the incomes
 * list, the vote rows, the vote circles, the qualification sum — it has to say
 * so, and this is the one place that decides what that means.
 *
 * The feed and the queue are the exceptions on purpose: a bot row in "Lately"
 * is the whole point of the feature, and it renders with its own colour like
 * anybody else.
 *
 * Pure and total: a null person is not a human either, which keeps the call
 * sites free of `p && !isBot(p)`.
 */

import type { Person } from "@/lib/types";

/** The `people.key` the migration inserts. Matched on the key, never the name —
 *  names are editable from the incomes popover, keys are not. */
export const BOT_KEY = "bot";

export function isBot(person: { key?: string | null } | null | undefined): boolean {
  return person?.key === BOT_KEY;
}

/** The roster minus the machinery. Preserves order. */
export function humans<T extends { key?: string | null }>(people: readonly T[]): T[] {
  return people.filter((p) => !isBot(p));
}

/**
 * Combined annual income, bot excluded — the numerator of the 40x check.
 * `annual_income` is 0 on the bot row anyway; this is belt and braces, and it
 * is the function the test pins.
 */
export function combinedIncome(people: readonly Person[]): number {
  return humans(people).reduce((sum, p) => sum + (p.annual_income ?? 0), 0);
}

/**
 * The people named by a set of ids, in the order the ids were given.
 *
 * The follow-up owners (0014) are stored as `uuid[]` on the listing, and the
 * roster is four rows the client already holds — so a name and a colour is a
 * lookup, never a join. Pure and total on purpose:
 *
 *  - an id that names nobody is skipped, not rendered as a grey blank. A
 *    `people` row can be deleted and a listing's array outlives it;
 *  - a duplicate id yields one person, so two dots can never be the same face;
 *  - a null/undefined array is an empty list, which is what a pre-0014 row and
 *    a listing nobody has assigned both look like.
 *
 * The bot is *not* filtered here: `usePerson().people` is already humans-only,
 * and filtering twice would quietly hide a real person if the roster ever
 * arrived unfiltered.
 */
export function ownersOf<T extends { id: string }>(
  ids: readonly string[] | null | undefined,
  people: readonly T[] | null | undefined,
): T[] {
  if (!ids || ids.length === 0 || !people || people.length === 0) return [];
  const byId = new Map(people.map((person) => [person.id, person]));
  const out: T[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const person = byId.get(id);
    if (person) out.push(person);
  }
  return out;
}

/**
 * Who is on a listing's follow-up, as ids.
 *
 * `next_action_owners` (0014) is the truth. The fallback to the scalar
 * `next_action_owner` is not belt and braces about the data — the migration
 * backfills it and every write sets both — it is about *order*: the SQL in this
 * repo is applied by hand, so there is a window where this code is deployed and
 * the column is not. Without the fallback, every owner dot in the app quietly
 * disappears until somebody runs 0014.
 */
export function ownerIdsOf(listing: {
  next_action_owners?: readonly string[] | null;
  next_action_owner?: string | null;
}): string[] {
  const owners = listing.next_action_owners;
  if (owners && owners.length > 0) return [...owners];
  return listing.next_action_owner ? [listing.next_action_owner] : [];
}

/**
 * The owners as one phrase for an activity summary: "Dylan, Reese", or
 * "unassigned" when nobody is on it.
 *
 * Rendered at insert time like every other summary, so it is a snapshot of what
 * was decided and does not follow a later rename.
 */
export function ownerNames(names: readonly string[] | null | undefined): string {
  const listed = (names ?? []).map((name) => name.trim()).filter(Boolean);
  return listed.length > 0 ? listed.join(", ") : "unassigned";
}
