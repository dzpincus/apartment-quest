import { describe, expect, it } from "vitest";
import { BOT_KEY, combinedIncome, humans, isBot } from "./people";
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
