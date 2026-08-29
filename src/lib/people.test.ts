import { describe, expect, it } from "vitest";
import {
  BOT_KEY,
  combinedIncome,
  humans,
  isBot,
  ownerIdsOf,
  ownerNames,
  ownersOf,
} from "./people";
import type { Person } from "./types";

function person(over: Partial<Person> & { key: string }): Person {
  return {
    id: `id-${over.key}`,
    name: over.key,
    color: "#ffffff",
    annual_income: 0,
    created_at: null,
    ...over,
  };
}

const DYLAN = person({ key: "dylan", name: "Dylan", annual_income: 90_000 });
const REESE = person({ key: "reese", name: "Reese", annual_income: 110_000 });
const BOT = person({ key: BOT_KEY, name: "Quest Bot", annual_income: 0 });

describe("isBot", () => {
  it("matches on the key, not the name", () => {
    expect(isBot(BOT)).toBe(true);
    expect(isBot(person({ key: "dylan", name: "Quest Bot" }))).toBe(false);
  });

  it("is false for every housemate", () => {
    expect(isBot(DYLAN)).toBe(false);
    expect(isBot(REESE)).toBe(false);
  });

  it("treats nobody as not-a-human, so call sites need no null dance", () => {
    expect(isBot(null)).toBe(false);
    expect(isBot(undefined)).toBe(false);
    expect(isBot({})).toBe(false);
  });
});

describe("humans", () => {
  it("drops the bot and keeps the order", () => {
    expect(humans([DYLAN, BOT, REESE]).map((p) => p.key)).toEqual(["dylan", "reese"]);
  });

  it("does not mutate the list it was given", () => {
    const roster = [DYLAN, BOT];
    humans(roster);
    expect(roster).toHaveLength(2);
  });

  it("is a no-op on a roster that has no bot yet (pre-0006 databases)", () => {
    expect(humans([DYLAN, REESE])).toEqual([DYLAN, REESE]);
  });
});

describe("combinedIncome — the qualification numerator", () => {
  it("sums the housemates", () => {
    expect(combinedIncome([DYLAN, REESE])).toBe(200_000);
  });

  it("excludes the bot even if somebody types an income into its row", () => {
    const richBot = person({ key: BOT_KEY, annual_income: 5_000_000 });
    expect(combinedIncome([DYLAN, REESE, richBot])).toBe(200_000);
  });

  it("treats a null income as zero rather than NaN", () => {
    expect(combinedIncome([DYLAN, person({ key: "brenna", annual_income: null })])).toBe(
      90_000,
    );
  });

  it("is zero for an empty roster", () => {
    expect(combinedIncome([])).toBe(0);
  });
});

describe("ownersOf — the follow-up owners (0014)", () => {
  const roster = [DYLAN, REESE, BOT];

  it("resolves ids to people in the order the ids were given", () => {
    expect(ownersOf([REESE.id, DYLAN.id], roster)).toEqual([REESE, DYLAN]);
  });

  it("skips an id that names nobody rather than drawing a blank dot", () => {
    // A `people` row can be deleted; the listing's array outlives it.
    expect(ownersOf(["ghost", DYLAN.id], roster)).toEqual([DYLAN]);
  });

  it("never returns the same person twice", () => {
    expect(ownersOf([DYLAN.id, DYLAN.id], roster)).toEqual([DYLAN]);
  });

  it("reads an absent array as nobody", () => {
    expect(ownersOf([], roster)).toEqual([]);
    expect(ownersOf(null, roster)).toEqual([]);
    expect(ownersOf(undefined, roster)).toEqual([]);
  });

  it("survives an empty or missing roster", () => {
    expect(ownersOf([DYLAN.id], [])).toEqual([]);
    expect(ownersOf([DYLAN.id], undefined)).toEqual([]);
  });

  it("does not filter the bot: the roster it is handed is already human-only", () => {
    // `usePerson().people` filters once. Filtering again here would hide a real
    // person the day somebody passes an unfiltered list on purpose.
    expect(ownersOf([BOT.id], roster)).toEqual([BOT]);
  });
});

describe("ownerNames — the feed line", () => {
  it("lists the names", () => {
    expect(ownerNames(["Dylan", "Reese"])).toBe("Dylan, Reese");
  });

  it("says unassigned rather than printing an empty pair of brackets", () => {
    expect(ownerNames([])).toBe("unassigned");
    expect(ownerNames(null)).toBe("unassigned");
    expect(ownerNames(undefined)).toBe("unassigned");
    expect(ownerNames(["", "  "])).toBe("unassigned");
  });

  it("drops a blank name without leaving a stray comma", () => {
    expect(ownerNames(["Dylan", "", "Reese"])).toBe("Dylan, Reese");
  });
});

describe("ownerIdsOf — the array is the truth, the scalar is the fallback", () => {
  it("reads the array", () => {
    expect(ownerIdsOf({ next_action_owners: ["a", "b"], next_action_owner: "a" })).toEqual([
      "a",
      "b",
    ]);
  });

  it("falls back to the scalar while 0014 has not been applied yet", () => {
    // The SQL in this repo goes in by hand, so there is a window where the code
    // is deployed and the column is not. Without this, every owner dot vanishes.
    expect(ownerIdsOf({ next_action_owner: "a" })).toEqual(["a"]);
    expect(ownerIdsOf({ next_action_owners: null, next_action_owner: "a" })).toEqual(["a"]);
  });

  it("does not resurrect a scalar the array deliberately emptied", () => {
    // Both are written by the same statement, so an empty array with a scalar
    // set is not a state the app can produce — but if it ever reads one, the
    // array wins only when it has something in it. This is the documented
    // trade: a stale mirror is preferred to no owners at all.
    expect(ownerIdsOf({ next_action_owners: [], next_action_owner: null })).toEqual([]);
  });

  it("is nobody for a listing with neither", () => {
    expect(ownerIdsOf({})).toEqual([]);
    expect(ownerIdsOf({ next_action_owners: [], next_action_owner: null })).toEqual([]);
  });

  it("copies rather than handing back the row's own array", () => {
    const owners = ["a"];
    const out = ownerIdsOf({ next_action_owners: owners });
    expect(out).not.toBe(owners);
  });
});
