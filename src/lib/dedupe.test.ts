import { describe, expect, it } from "vitest";
import { dedupeKey, qualification } from "./dedupe";

/**
 * Non-ASCII inputs are written as `\uXXXX` escapes on purpose. The whole point
 * of these tests is which codepoint went in, and a literal accented character
 * in the source hides the difference between a precomposed letter and a base
 * letter plus a combining mark.
 */
const E_ACUTE = "é"; // precomposed "e-acute"
const COMBINING_ACUTE = "́";
const A_ACUTE_UPPER = "Á";
const A_RING = "Å";
const SHARP_S = "ß";
const NBSP = " ";
const TOKYO = "東京";
const HOUSE = "🏠"; // house emoji, a surrogate pair
const DOTTED_I = "İ"; // Turkish capital I with dot
const DOTLESS_I = "ı";
const FULLWIDTH_2 = "２";
const FI_LIGATURE = "ﬁ";
const EM_DASH = "—";

describe("dedupeKey", () => {
  it("lowercases and strips everything but alphanumerics and the separator", () => {
    expect(dedupeKey("214 Grand St", "4B")).toBe("214grandst|4b");
  });

  it("ignores spacing, punctuation and case differences", () => {
    expect(dedupeKey("214 Grand St.", "#4B")).toBe(dedupeKey("214  grand st", "4b"));
    expect(dedupeKey("214-Grand_St", "Apt 4B")).toBe("214grandst|apt4b");
  });

  it("keeps the separator so address+unit never collides with address alone", () => {
    expect(dedupeKey("214 Grand St 4B", null)).toBe("214grandst4b|");
    expect(dedupeKey("214 Grand St", "4B")).toBe("214grandst|4b");
    expect(dedupeKey("214 Grand St 4B", null)).not.toBe(dedupeKey("214 Grand St", "4B"));
  });

  it("treats null, undefined and empty unit identically", () => {
    expect(dedupeKey("214 Grand St", null)).toBe("214grandst|");
    expect(dedupeKey("214 Grand St")).toBe("214grandst|");
    expect(dedupeKey("214 Grand St", "")).toBe("214grandst|");
    expect(dedupeKey("214 Grand St", "   ")).toBe("214grandst|");
  });

  it("handles a null address", () => {
    expect(dedupeKey(null, null)).toBe("|");
  });

  it("collapses every flavour of nothing to the bare separator", () => {
    expect(dedupeKey("", "")).toBe("|");
    expect(dedupeKey(undefined, undefined)).toBe("|");
    expect(dedupeKey(null, "")).toBe("|");
    expect(dedupeKey("", null)).toBe("|");
    expect(dedupeKey("   ", "\t\n")).toBe("|");
  });

  it("keeps a unit-only row addressable", () => {
    expect(dedupeKey(null, "4B")).toBe("|4b");
    expect(dedupeKey("", "#4B")).toBe("|4b");
    expect(dedupeKey(undefined, "Apt. 4-B")).toBe("|apt4b");
  });

  it("strips tabs, newlines, CRLF and non-breaking spaces", () => {
    expect(dedupeKey("214\tGrand\nSt", "4B")).toBe("214grandst|4b");
    expect(dedupeKey("214 Grand St\r\n", "4B")).toBe("214grandst|4b");
    expect(dedupeKey("  214 Grand St  ", "  4B  ")).toBe("214grandst|4b");
    // NBSP is U+00A0, outside ASCII, so the negated class eats it too.
    expect(dedupeKey(`214${NBSP}Grand${NBSP}St`, "4B")).toBe("214grandst|4b");
  });

  it("strips '#' and '.' wherever they appear, not just as a prefix", () => {
    expect(dedupeKey("214 Grand St.", "#4B")).toBe("214grandst|4b");
    expect(dedupeKey("214 Grand St", "##4B")).toBe("214grandst|4b");
    expect(dedupeKey("214 Grand St", "4.B")).toBe("214grandst|4b");
    expect(dedupeKey("St. Marks Pl.", "Apt #2R")).toBe("stmarkspl|apt2r");
    expect(dedupeKey("214 Grand St", "#4B")).toBe(dedupeKey("214 Grand St", "4B"));
  });

  it("drops non-ASCII entirely, the way a codepoint range must", () => {
    // `[^a-zA-Z0-9|]` is a codepoint range in Postgres and in JS alike:
    // anything above U+007A is outside a-z and is removed, never folded.
    expect(dedupeKey(`Caf${E_ACUTE} ${A_ACUTE_UPPER}venue`, null)).toBe("cafvenue|");
    expect(dedupeKey(`${A_RING}lesund Stra${SHARP_S}e`, null)).toBe("lesundstrae|");
    expect(dedupeKey(`${TOKYO} 214`, null)).toBe("214|");
    expect(dedupeKey(`214 Grand ${HOUSE}`, null)).toBe("214grand|");
    expect(dedupeKey(`${FI_LIGATURE}rst`, null)).toBe("rst|");
    expect(dedupeKey(`${EM_DASH}Grand${EM_DASH}`, null)).toBe("grand|");
    // Fullwidth digits are not ASCII digits, so they vanish as well.
    expect(dedupeKey(`${FULLWIDTH_2}14 Grand St`, null)).toBe("14grandst|");
  });

  it("removes a combining mark but keeps the ASCII letter under it", () => {
    const decomposed = `Cafe${COMBINING_ACUTE}`;
    const precomposed = `Caf${E_ACUTE}`;
    expect(dedupeKey(decomposed, null)).toBe("cafe|");
    expect(dedupeKey(precomposed, null)).toBe("caf|");
    // So the two spellings of the same word are NOT the same key. A real
    // limitation inherited from the generated column, documented rather than
    // fixed: normalising here would break parity with Postgres, which is worse.
    expect(dedupeKey(decomposed, null)).not.toBe(dedupeKey(precomposed, null));
  });

  it("does not case-fold anything the regex already removed", () => {
    // U+0130 is stripped before `lower()` would ever see it, so no
    // locale-dependent Turkish folding can break parity with Postgres.
    expect(dedupeKey(`${DOTTED_I}stanbul Ave`, null)).toBe("stanbulave|");
    expect(dedupeKey(`${DOTLESS_I}zmir`, null)).toBe("zmir|");
  });

  it("leaves a literal pipe alone, exactly as Postgres does", () => {
    // '|' is inside the keep-list, so an address containing one can forge a
    // unit boundary. Parity beats defensiveness: the client must agree with
    // the generated column or dedupe silently stops matching.
    expect(dedupeKey("214|Grand", "")).toBe("214|grand|");
    expect(dedupeKey("214", "Grand|")).toBe("214|grand|");
    expect(dedupeKey("214|Grand", "")).toBe(dedupeKey("214", "Grand|"));
  });

  it("only ever emits lowercase ASCII alphanumerics and pipes", () => {
    const inputs: Array<[string | null | undefined, string | null | undefined]> = [
      ["214 Grand St", "4B"],
      [`Caf${E_ACUTE} ${TOKYO} ${HOUSE}`, "#4-B"],
      [`${DOTTED_I}stanbul`, " "],
      ["", ""],
      [null, undefined],
      ["MiXeD CaSe 99", "ZzZ"],
    ];
    for (const [address, unit] of inputs) {
      expect(dedupeKey(address, unit)).toMatch(/^[a-z0-9|]*$/);
    }
  });
});

/**
 * Parity guard for the generated column in 0001_schema.sql:
 *
 *   lower(regexp_replace(coalesce(address,'') || '|' || coalesce(unit,''),
 *                        '[^a-zA-Z0-9|]', '', 'g'))
 *
 * The oracle is deliberately written *without* a regex and *without*
 * `toLowerCase()`: it walks codepoints and folds A-Z by hand, which is exactly
 * what Postgres does to an ASCII-only string. Reimplementing `dedupeKey` with
 * the same regex would only prove that the regex equals itself.
 */
function pgDedupeKey(
  address: string | null | undefined,
  unit?: string | null | undefined,
): string {
  const raw = `${address ?? ""}|${unit ?? ""}`;
  let out = "";
  for (const ch of raw) {
    const c = ch.codePointAt(0)!;
    const keep =
      (c >= 0x30 && c <= 0x39) || // 0-9
      (c >= 0x41 && c <= 0x5a) || // A-Z
      (c >= 0x61 && c <= 0x7a) || // a-z
      c === 0x7c; // |
    if (!keep) continue;
    out += c >= 0x41 && c <= 0x5a ? String.fromCodePoint(c + 32) : ch;
  }
  return out;
}

describe("dedupeKey — Postgres parity", () => {
  const cases: Array<[string | null | undefined, string | null | undefined]> = [
    ["214 Grand St", "4B"],
    ["214 Grand St.", "#4B"],
    ["St. Marks Pl.", "Apt #2R"],
    [`Caf${E_ACUTE} ${A_ACUTE_UPPER}venue`, null],
    [`${A_RING}lesund Stra${SHARP_S}e`, ""],
    [`${TOKYO} 214`, `${FULLWIDTH_2}B`],
    [`214 Grand ${HOUSE}`, HOUSE],
    [`${DOTTED_I}stanbul Ave`, DOTLESS_I],
    [`Cafe${COMBINING_ACUTE}`, `Caf${E_ACUTE}`],
    ["214\tGrand\r\nSt", " 4B "],
    ["214|Grand", "|"],
    ["", ""],
    [null, null],
    [undefined, undefined],
    ["   ", "   "],
    ["ALL CAPS 123", "ZZZ"],
    ["mixed_Case-99", "a.b.c"],
    [`${FI_LIGATURE}rst ligature`, `${EM_DASH}dash${EM_DASH}`],
    [NBSP, NBSP],
  ];

  it.each(cases)("matches the generated column for (%j, %j)", (address, unit) => {
    expect(dedupeKey(address, unit)).toBe(pgDedupeKey(address, unit));
  });

  it("agrees with the oracle across a deterministic sweep of tricky characters", () => {
    const pool = [
      ..."aZ09 .#-_|/",
      "\t",
      "\n",
      "\r",
      NBSP,
      E_ACUTE,
      A_ACUTE_UPPER,
      COMBINING_ACUTE,
      TOKYO,
      HOUSE,
      DOTTED_I,
      FI_LIGATURE,
      FULLWIDTH_2,
    ];
    // Every ordered pair, once as the address and once as the unit.
    for (const a of pool) {
      for (const b of pool) {
        const s = `${a}${b}`;
        expect(dedupeKey(s, null)).toBe(pgDedupeKey(s, null));
        expect(dedupeKey("214 Grand St", s)).toBe(pgDedupeKey("214 Grand St", s));
      }
    }
  });
});

describe("qualification", () => {
  const rent = 6000; // 40x => $240,000 combined

  it("uses 40x monthly rent, not 40x annual rent", () => {
    expect(qualification(rent, 40, []).required).toBe(240_000);
  });

  it("passes exactly at the boundary", () => {
    const q = qualification(rent, 40, [120_000, 120_000]);
    expect(q.combined).toBe(240_000);
    expect(q.passes).toBe(true);
    expect(q.ratio).toBe(1);
  });

  it("fails one dollar under", () => {
    expect(qualification(rent, 40, [120_000, 119_999]).passes).toBe(false);
  });

  it("sums all four incomes and tolerates nulls", () => {
    const q = qualification(3_200, 40, [90_000, 80_000, null, undefined]);
    expect(q.combined).toBe(170_000);
    expect(q.required).toBe(128_000);
    expect(q.passes).toBe(true);
  });

  it("defaults the multiplier to 40 when the listing has none", () => {
    expect(qualification(3_200, null, [0]).required).toBe(128_000);
  });

  it("honours a non-standard multiplier", () => {
    expect(qualification(3_200, 45, [0]).required).toBe(144_000);
  });

  it("is a no-op pass when rent is unknown", () => {
    const q = qualification(null, 40, [100_000]);
    expect(q.required).toBe(0);
    expect(q.passes).toBe(true);
    expect(q.ratio).toBe(1);
  });

  it("treats an all-null roster as zero combined income", () => {
    const q = qualification(3_200, 40, [null, null, null, null]);
    expect(q.combined).toBe(0);
    expect(q.passes).toBe(false);
    expect(q.ratio).toBe(0);
  });

  it("rounds a fractional multiplier to whole dollars", () => {
    expect(qualification(3_333, 40.5, []).required).toBe(134_987); // 134986.5
  });

  it("never asks for a negative income", () => {
    expect(qualification(-100, 40, [0]).required).toBe(0);
    expect(qualification(-100, 40, [0]).passes).toBe(true);
  });

  it("reports a ratio the caller can render as a percentage", () => {
    expect(qualification(1_000, 40, [20_000]).ratio).toBeCloseTo(0.5, 10);
    expect(qualification(1_000, 40, [80_000]).ratio).toBeCloseTo(2, 10);
  });
});
