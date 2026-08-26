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
