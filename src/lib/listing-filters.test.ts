import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  amenityRank,
  applyFilters,
  clearFilter,
  defaultSortDir,
  EMPTY_FILTERS,
  FILTER_KEYS,
  hasActiveFilters,
  matchesLinkState,
  neighborhoods,
  sortRows,
  transitSeconds,
  type Filters,
  type SortKey,
} from "./listing-filters";
import type { CommuteRef, ListingRow, VoteRow } from "./queries";
import type { FeeType, ListingStatus, VoteValue } from "./types";

const ME = "person-me";
const THEM = "person-them";

function vote(personId: string, value: VoteValue | null): VoteRow {
  return { person_id: personId, vote: value, comment: null, updated_at: null };
}

/** A minimal listing row; every test opts into the columns it cares about. */
function row(over: Partial<ListingRow> & { id: string }): ListingRow {
  return {
    address: "214 Grand St",
    unit: null,
    neighborhood: null,
    rent: null,
    beds: null,
    baths: null,
    sqft: null,
    url: null,
    available_date: null,
    fee_type: null,
    broker_fee_pct: null,
    guarantor_ok: null,
    income_multiplier: 40,
    trains: null,
    notes: null,
    pets: null,
    pet_notes: null,
    laundry: null,
    dishwasher: null,
    ac: null,
    outdoor_space: null,
    broker_id: null,
    added_by: null,
    status: "saved",
    last_contacted_at: null,
    next_action: null,
    next_action_due: null,
    next_action_owner: null,
    dedupe_key: "",
    merged_into: null,
    created_at: null,
    updated_at: null,
    broker: null,
    added_by_person: null,
    next_action_owner_person: null,
    votes: [],
    ...over,
  } as ListingRow;
}

const filters = (over: Partial<Filters> = {}): Filters => ({ ...EMPTY_FILTERS, ...over });
const ids = (rows: ListingRow[]) => rows.map((r) => r.id);

describe("EMPTY_FILTERS / hasActiveFilters", () => {
  it("starts inactive", () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
  });

  it("notices any single field being set", () => {
    const set: Array<Partial<Filters>> = [
      { rentMin: "2000" },
      { rentMax: "5000" },
      { bedsMin: "2" },
      { neighborhood: "Bushwick" },
      { status: "contacted" },
      { linkState: "gone" },
      { linkState: "unchecked" },
      { feeType: "no_fee" },
      { pets: "yes" },
      { pets: "unknown" },
      { laundry: "in_unit" },
      { laundry: "unknown" },
      { dishwasher: "yes" },
      { ac: "central" },
      { outdoor_space: "private" },
      { myVote: "yes" },
      { myVote: "none" },
    ];
    for (const over of set) {
      expect(hasActiveFilters(filters(over))).toBe(true);
    }
  });

  it("does not treat the 'all' sentinels or empty strings as active", () => {
    expect(
      hasActiveFilters(
        filters({
          neighborhood: "all",
          status: "all",
          linkState: "all",
          feeType: "all",
          pets: "all",
          laundry: "all",
          dishwasher: "all",
          ac: "all",
          outdoor_space: "all",
          myVote: "all",
        }),
      ),
    ).toBe(false);
  });
});

describe("activeFilterCount / clearFilter", () => {
  it("counts nothing on the default filters", () => {
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
  });

  it("counts one per narrowed field, rent min and max separately", () => {
    expect(activeFilterCount(filters({ pets: "yes" }))).toBe(1);
    expect(activeFilterCount(filters({ rentMin: "2000", rentMax: "4000" }))).toBe(2);
    expect(
      activeFilterCount(
        filters({
          rentMin: "2000",
          rentMax: "4000",
          bedsMin: "2",
          neighborhood: "Bushwick",
          status: "contacted",
          linkState: "live",
          feeType: "no_fee",
          pets: "yes",
          laundry: "in_unit",
          dishwasher: "yes",
          ac: "central",
          outdoor_space: "private",
          myVote: "none",
        }),
      ),
    ).toBe(FILTER_KEYS.length);
  });

  it("counts an explicit 'unknown' pick — it is a narrowing, not a default", () => {
    expect(activeFilterCount(filters({ pets: "unknown" }))).toBe(1);
    expect(activeFilterCount(filters({ laundry: "unknown", myVote: "none" }))).toBe(2);
  });

  it("agrees with hasActiveFilters", () => {
    const cases = [EMPTY_FILTERS, filters({ ac: "window" }), filters({ bedsMin: "1" })];
    for (const f of cases) {
      expect(hasActiveFilters(f)).toBe(activeFilterCount(f) > 0);
    }
  });

  it("lists every filter exactly once", () => {
    expect([...FILTER_KEYS].sort()).toEqual(
      (Object.keys(EMPTY_FILTERS) as Array<keyof Filters>).sort(),
    );
  });

  it("clears one field and leaves the rest alone", () => {
    const before = filters({ rentMax: "4000", pets: "yes", neighborhood: "Bushwick" });
    const after = clearFilter(before, "pets");
    expect(after.pets).toBe("all");
    expect(after.rentMax).toBe("4000");
    expect(after.neighborhood).toBe("Bushwick");
    expect(activeFilterCount(after)).toBe(2);
    // Pure: the caller's object is untouched.
    expect(before.pets).toBe("yes");
  });

  it("clearing every active field lands back on the defaults", () => {
    const before = filters({ rentMin: "1", rentMax: "2", bedsMin: "3", myVote: "yes" });
    const after = FILTER_KEYS.reduce(clearFilter, before);
    expect(after).toEqual(EMPTY_FILTERS);
  });
});

describe("applyFilters — nothing to do", () => {
  it("returns an empty list for an empty list", () => {
    expect(applyFilters([], EMPTY_FILTERS)).toEqual([]);
    expect(applyFilters([], filters({ rentMin: "1000" }))).toEqual([]);
  });

  it("passes everything through when no filter is set", () => {
    const rows = [row({ id: "a" }), row({ id: "b", rent: 9999 })];
    expect(ids(applyFilters(rows, EMPTY_FILTERS))).toEqual(["a", "b"]);
  });

  it("does not mutate the input array", () => {
    const rows = [row({ id: "a", rent: 1000 }), row({ id: "b", rent: 9000 })];
    applyFilters(rows, filters({ rentMin: "5000" }));
    expect(ids(rows)).toEqual(["a", "b"]);
  });
});

describe("applyFilters — rent", () => {
  const rows = [
    row({ id: "cheap", rent: 2000 }),
    row({ id: "mid", rent: 3200 }),
    row({ id: "dear", rent: 6000 }),
    row({ id: "unknown", rent: null }),
  ];

  it("is inclusive at both ends", () => {
    expect(ids(applyFilters(rows, filters({ rentMin: "3200" })))).toEqual(["mid", "dear"]);
    expect(ids(applyFilters(rows, filters({ rentMax: "3200" })))).toEqual(["cheap", "mid"]);
    expect(ids(applyFilters(rows, filters({ rentMin: "3200", rentMax: "3200" })))).toEqual([
      "mid",
    ]);
  });

  it("treats a listing with no rent as free at the bottom and infinite at the top", () => {
    // Deliberate asymmetry: a min never hides an unpriced listing, a max does.
    expect(ids(applyFilters(rows, filters({ rentMin: "1" })))).toEqual([
      "cheap",
      "mid",
      "dear",
    ]);
    expect(applyFilters(rows, filters({ rentMin: "0" })).map((r) => r.id)).toContain(
      "unknown",
    );
    expect(ids(applyFilters(rows, filters({ rentMax: "99999" })))).toEqual([
      "cheap",
      "mid",
      "dear",
    ]);
  });

  it("returns nothing when the range is inverted", () => {
    expect(applyFilters(rows, filters({ rentMin: "5000", rentMax: "3000" }))).toEqual([]);
  });

  it("ignores a bound that is not a number", () => {
    expect(ids(applyFilters(rows, filters({ rentMin: "abc" })))).toEqual(ids(rows));
    expect(ids(applyFilters(rows, filters({ rentMax: "   " })))).toEqual(ids(rows));
    expect(ids(applyFilters(rows, filters({ rentMin: "" })))).toEqual(ids(rows));
  });
});

describe("applyFilters — beds", () => {
  const rows = [
    row({ id: "studio", beds: 0 }),
    row({ id: "one", beds: 1 }),
    row({ id: "two-half", beds: 2.5 }),
    row({ id: "unknown", beds: null }),
  ];

  it("is a minimum, inclusive", () => {
    expect(ids(applyFilters(rows, filters({ bedsMin: "1" })))).toEqual(["one", "two-half"]);
    expect(ids(applyFilters(rows, filters({ bedsMin: "2.5" })))).toEqual(["two-half"]);
  });

  it("counts a null bedroom count as zero", () => {
    expect(ids(applyFilters(rows, filters({ bedsMin: "0" })))).toEqual(ids(rows));
    expect(applyFilters(rows, filters({ bedsMin: "1" })).map((r) => r.id)).not.toContain(
      "unknown",
    );
  });
});

describe("applyFilters — neighborhood, status and fee", () => {
  const rows = [
    row({ id: "wburg", neighborhood: "Williamsburg", status: "saved", fee_type: "no_fee" }),
    row({ id: "bushwick", neighborhood: "Bushwick", status: "contacted", fee_type: "fee" }),
    row({ id: "nowhere", neighborhood: null, status: null, fee_type: null }),
  ];

  it("matches a neighborhood exactly and case-sensitively", () => {
    expect(ids(applyFilters(rows, filters({ neighborhood: "Bushwick" })))).toEqual([
      "bushwick",
    ]);
    expect(applyFilters(rows, filters({ neighborhood: "bushwick" }))).toEqual([]);
  });

  it("has no way to ask for a null neighborhood except the empty string", () => {
    expect(ids(applyFilters(rows, filters({ neighborhood: "" })))).toEqual(["nowhere"]);
  });

  it("matches a status exactly, and a null status matches nothing", () => {
    expect(ids(applyFilters(rows, filters({ status: "contacted" })))).toEqual(["bushwick"]);
    for (const status of ["saved", "contacted", "passed"] as ListingStatus[]) {
      expect(applyFilters([rows[2]], filters({ status }))).toEqual([]);
    }
  });

  it("reads a null fee_type as 'unknown', matching the column default", () => {
    expect(ids(applyFilters(rows, filters({ feeType: "unknown" })))).toEqual(["nowhere"]);
    expect(ids(applyFilters(rows, filters({ feeType: "no_fee" })))).toEqual(["wburg"]);
    for (const feeType of ["op"] as FeeType[]) {
      expect(applyFilters(rows, filters({ feeType }))).toEqual([]);
    }
  });

  it("intersects filters rather than unioning them", () => {
    expect(
      applyFilters(rows, filters({ neighborhood: "Bushwick", status: "saved" })),
    ).toEqual([]);
  });
});

describe("applyFilters — pets", () => {
  const rows = [
    row({ id: "anything", pets: "yes" }),
    row({ id: "cats", pets: "cats_only" }),
    row({ id: "dogs", pets: "dogs_only" }),
    row({ id: "none-allowed", pets: "no" }),
    row({ id: "never-asked", pets: "unknown" }),
    row({ id: "pre-migration", pets: null }),
  ];

  it("matches one policy at a time", () => {
    expect(ids(applyFilters(rows, filters({ pets: "yes" })))).toEqual(["anything"]);
    expect(ids(applyFilters(rows, filters({ pets: "cats_only" })))).toEqual(["cats"]);
    expect(ids(applyFilters(rows, filters({ pets: "dogs_only" })))).toEqual(["dogs"]);
    expect(ids(applyFilters(rows, filters({ pets: "no" })))).toEqual(["none-allowed"]);
  });

  it("reads a null column as 'unknown', matching the column default", () => {
    // Rows written before 0005 have no value at all; they are unanswered
    // questions, not a policy of their own.
    expect(ids(applyFilters(rows, filters({ pets: "unknown" })))).toEqual([
      "never-asked",
      "pre-migration",
    ]);
  });

  it("passes everything through on 'all'", () => {
    expect(applyFilters(rows, filters({ pets: "all" }))).toHaveLength(rows.length);
  });

  it("intersects with the other filters rather than unioning them", () => {
    expect(
      applyFilters(rows, filters({ pets: "yes", status: "applied" })),
    ).toEqual([]);
  });
});

describe("sortRows — pets", () => {
  const rows = [
    row({ id: "never-asked", pets: "unknown" }),
    row({ id: "none-allowed", pets: "no" }),
    row({ id: "anything", pets: "yes" }),
    row({ id: "dogs", pets: "dogs_only" }),
    row({ id: "cats", pets: "cats_only" }),
  ];

  it("ranks most permissive first rather than alphabetically", () => {
    // Alphabetically "yes" sorts last, which would bury the answer everyone
    // is scanning for.
    expect(ids(sortRows(rows, { key: "pets", dir: "asc" }))).toEqual([
      "anything",
      "cats",
      "dogs",
      "none-allowed",
      "never-asked",
    ]);
  });

  it("reverses cleanly", () => {
    expect(ids(sortRows(rows, { key: "pets", dir: "desc" }))).toEqual([
      "never-asked",
      "none-allowed",
      "dogs",
      "cats",
      "anything",
    ]);
  });

  it("sorts a null column with the unknowns, not as a blank", () => {
    const withNull = [row({ id: "pre-migration", pets: null }), ...rows];
    expect(ids(sortRows(withNull, { key: "pets", dir: "asc" })).slice(-2)).toEqual([
      "pre-migration",
      "never-asked",
    ]);
  });

  it("opens ascending on the first click", () => {
    expect(defaultSortDir("pets")).toBe("asc");
  });
});

describe("applyFilters — amenities", () => {
  const rows = [
    row({ id: "in-unit", laundry: "in_unit", dishwasher: "yes", ac: "central" }),
    row({ id: "basement", laundry: "in_building", ac: "window" }),
    row({ id: "laundromat", laundry: "none", dishwasher: "no", ac: "none" }),
    row({ id: "never-asked", laundry: "unknown" }),
    row({ id: "pre-migration" }),
    row({ id: "balcony", outdoor_space: "private" }),
    row({ id: "roof", outdoor_space: "shared" }),
  ];

  it("matches one laundry answer at a time", () => {
    expect(ids(applyFilters(rows, filters({ laundry: "in_unit" })))).toEqual(["in-unit"]);
    expect(ids(applyFilters(rows, filters({ laundry: "in_building" })))).toEqual([
      "basement",
    ]);
    expect(ids(applyFilters(rows, filters({ laundry: "none" })))).toEqual(["laundromat"]);
  });

  it("matches the dishwasher, the AC and the outdoor space the same way", () => {
    expect(ids(applyFilters(rows, filters({ dishwasher: "yes" })))).toEqual(["in-unit"]);
    expect(ids(applyFilters(rows, filters({ dishwasher: "no" })))).toEqual(["laundromat"]);
    expect(ids(applyFilters(rows, filters({ ac: "central" })))).toEqual(["in-unit"]);
    expect(ids(applyFilters(rows, filters({ ac: "window" })))).toEqual(["basement"]);
    expect(ids(applyFilters(rows, filters({ outdoor_space: "private" })))).toEqual([
      "balcony",
    ]);
    expect(ids(applyFilters(rows, filters({ outdoor_space: "shared" })))).toEqual(["roof"]);
  });

  it("reads a null column as 'unknown', matching the column default", () => {
    // Rows written before 0009 have no value at all; they are unanswered
    // questions, not "this apartment has no laundry".
    expect(ids(applyFilters(rows, filters({ laundry: "unknown" })))).toEqual([
      "never-asked",
      "pre-migration",
      "balcony",
      "roof",
    ]);
  });

  it("passes everything through on 'all'", () => {
    expect(
      applyFilters(
        rows,
        filters({ laundry: "all", dishwasher: "all", ac: "all", outdoor_space: "all" }),
      ),
    ).toHaveLength(rows.length);
  });

  it("intersects the four rather than unioning them", () => {
    expect(
      ids(applyFilters(rows, filters({ laundry: "in_unit", ac: "central" }))),
    ).toEqual(["in-unit"]);
    expect(applyFilters(rows, filters({ laundry: "in_unit", ac: "window" }))).toEqual([]);
  });
});

describe("sortRows — amenities", () => {
  const rows = [
    row({ id: "nothing" }),
    row({ id: "laundromat", laundry: "none" }),
    row({ id: "basement", laundry: "in_building" }),
    row({ id: "in-unit", laundry: "in_unit" }),
  ];

  it("walks best-first: in_unit > in_building > none > unknown", () => {
    expect(ids(sortRows(rows, { key: "amenities", dir: "asc" }))).toEqual([
      "in-unit",
      "basement",
      "laundromat",
      "nothing",
    ]);
  });

  it("reverses cleanly", () => {
    expect(ids(sortRows(rows, { key: "amenities", dir: "desc" }))).toEqual([
      "nothing",
      "laundromat",
      "basement",
      "in-unit",
    ]);
  });

  it("lets laundry outrank the other three rather than adding them up", () => {
    // A dishwasher, central AC and a terrace must not lift a laundry-less
    // apartment above one with a washer in it — the packing is lexicographic.
    const packed = [
      row({ id: "everything-else", dishwasher: "yes", ac: "central", outdoor_space: "private" }),
      row({ id: "just-laundry", laundry: "in_unit" }),
    ];
    expect(ids(sortRows(packed, { key: "amenities", dir: "asc" }))).toEqual([
      "just-laundry",
      "everything-else",
    ]);
  });

  it("breaks a laundry tie on AC, then outdoor space, then the dishwasher", () => {
    const tied = [
      row({ id: "d", laundry: "in_unit" }),
      row({ id: "c", laundry: "in_unit", dishwasher: "yes" }),
      row({ id: "b", laundry: "in_unit", outdoor_space: "private" }),
      row({ id: "a", laundry: "in_unit", ac: "central" }),
    ];
    expect(ids(sortRows(tied, { key: "amenities", dir: "asc" }))).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("sorts a null column with the unknowns rather than as a blank", () => {
    expect(
      amenityRank({ laundry: null, dishwasher: null, ac: null, outdoor_space: null }),
    ).toBe(amenityRank({ laundry: "unknown", dishwasher: "unknown", ac: "unknown", outdoor_space: "unknown" }));
  });

  it("opens ascending on the first click", () => {
    expect(defaultSortDir("amenities")).toBe("asc");
  });
});

describe("applyFilters — my vote", () => {
  const rows = [
    row({ id: "i-said-yes", votes: [vote(ME, "yes"), vote(THEM, "no")] }),
    row({ id: "i-said-no", votes: [vote(ME, "no")] }),
    row({ id: "only-they-voted", votes: [vote(THEM, "yes")] }),
    row({ id: "nobody-voted", votes: [] }),
  ];

  it("filters on this device's person", () => {
    expect(ids(applyFilters(rows, filters({ myVote: "yes" }), ME))).toEqual(["i-said-yes"]);
    expect(ids(applyFilters(rows, filters({ myVote: "no" }), ME))).toEqual(["i-said-no"]);
  });

  it("'none' means the rows I have not voted on", () => {
    expect(ids(applyFilters(rows, filters({ myVote: "none" }), ME))).toEqual([
      "only-they-voted",
      "nobody-voted",
    ]);
  });

  it("hides nothing before the person gate has been answered", () => {
    // A null person must never blank the whole table.
    expect(ids(applyFilters(rows, filters({ myVote: "yes" }), null))).toEqual(ids(rows));
    expect(ids(applyFilters(rows, filters({ myVote: "none" })))).toEqual(ids(rows));
  });

  it("ignores a comment-only row, which is not a vote", () => {
    const rows2 = [row({ id: "comment-only", votes: [vote(ME, null)] })];
    expect(ids(applyFilters(rows2, filters({ myVote: "none" }), ME))).toEqual([
      "comment-only",
    ]);
    expect(applyFilters(rows2, filters({ myVote: "yes" }), ME)).toEqual([]);
  });
});

describe("defaultSortDir", () => {
  it("opens the ranked columns descending and the rest ascending", () => {
    expect(defaultSortDir("votes")).toBe("desc");
    expect(defaultSortDir("created_at")).toBe("desc");
    const ascending: SortKey[] = [
      "address",
      "neighborhood",
      "rent",
      "beds",
      "status",
      "broker",
      "next_action_due",
    ];
    for (const key of ascending) expect(defaultSortDir(key)).toBe("asc");
  });
});

describe("sortRows", () => {
  it("returns a new array and leaves the original alone", () => {
    const rows = [row({ id: "b", rent: 2 }), row({ id: "a", rent: 1 })];
    const sorted = sortRows(rows, { key: "rent", dir: "asc" });
    expect(sorted).not.toBe(rows);
    expect(ids(rows)).toEqual(["b", "a"]);
    expect(ids(sorted)).toEqual(["a", "b"]);
  });

  it("handles an empty list and a single row", () => {
    expect(sortRows([], { key: "rent", dir: "asc" })).toEqual([]);
    const one = [row({ id: "only" })];
    expect(ids(sortRows(one, { key: "votes", dir: "desc" }))).toEqual(["only"]);
  });

  it("sorts numbers numerically, not as strings", () => {
    const rows = [
      row({ id: "9", rent: 900 }),
      row({ id: "10", rent: 1000 }),
      row({ id: "1", rent: 100 }),
    ];
    expect(ids(sortRows(rows, { key: "rent", dir: "asc" }))).toEqual(["1", "9", "10"]);
    expect(ids(sortRows(rows, { key: "rent", dir: "desc" }))).toEqual(["10", "9", "1"]);
  });

  it("sinks blanks to the bottom in BOTH directions", () => {
    // The whole point of the null handling: an unpriced listing is never the
    // headline row, whichever way the column is pointing.
    const rows = [
      row({ id: "none", rent: null }),
      row({ id: "cheap", rent: 100 }),
      row({ id: "dear", rent: 900 }),
    ];
    expect(ids(sortRows(rows, { key: "rent", dir: "asc" }))).toEqual([
      "cheap",
      "dear",
      "none",
    ]);
    expect(ids(sortRows(rows, { key: "rent", dir: "desc" }))).toEqual([
      "dear",
      "cheap",
      "none",
    ]);
  });

  it("keeps two blanks in their original order", () => {
    const rows = [
      row({ id: "n1", neighborhood: null }),
      row({ id: "n2", neighborhood: null }),
      row({ id: "has", neighborhood: "Bushwick" }),
    ];
    expect(ids(sortRows(rows, { key: "neighborhood", dir: "asc" }))).toEqual([
      "has",
      "n1",
      "n2",
    ]);
  });

  it("sorts the address column case-insensitively, unit included", () => {
    const rows = [
      row({ id: "b", address: "beta ave", unit: null }),
      row({ id: "A", address: "Alpha St", unit: "2" }),
      row({ id: "A1", address: "Alpha St", unit: "1" }),
    ];
    expect(ids(sortRows(rows, { key: "address", dir: "asc" }))).toEqual(["A1", "A", "b"]);
  });

  it("sorts by broker name and sinks brokerless rows", () => {
    const withBroker = (id: string, name: string | null) =>
      row({
        id,
        broker: name
          ? { id: `b-${id}`, name, company: null, phone: null, email: null, notes: null }
          : null,
      });
    const rows = [withBroker("z", "Zoe"), withBroker("none", null), withBroker("a", "Adam")];
    expect(ids(sortRows(rows, { key: "broker", dir: "asc" }))).toEqual(["a", "z", "none"]);
    expect(ids(sortRows(rows, { key: "broker", dir: "desc" }))).toEqual(["z", "a", "none"]);
  });

  it("sorts votes by the score, most yeses first with nos as the tie-break", () => {
    const rows = [
      row({ id: "one-yes", votes: [vote("p1", "yes")] }),
      row({ id: "two-yes", votes: [vote("p1", "yes"), vote("p2", "yes")] }),
      row({ id: "one-yes-one-no", votes: [vote("p1", "yes"), vote("p2", "no")] }),
      row({ id: "silent", votes: [] }),
    ];
    expect(ids(sortRows(rows, { key: "votes", dir: "desc" }))).toEqual([
      "two-yes",
      "one-yes",
      "one-yes-one-no",
      "silent",
    ]);
  });

  it("never sinks a zero vote score, because zero is a number and not a blank", () => {
    const rows = [row({ id: "silent", votes: [] }), row({ id: "yes", votes: [vote("p", "yes")] })];
    expect(ids(sortRows(rows, { key: "votes", dir: "asc" }))).toEqual(["silent", "yes"]);
  });

  it("sorts date-only and timestamp columns lexically, which is chronological", () => {
    const rows = [
      row({ id: "later", next_action_due: "2025-09-10", created_at: "2025-09-10T00:00:00Z" }),
      row({ id: "none", next_action_due: null, created_at: null }),
      row({ id: "sooner", next_action_due: "2025-09-02", created_at: "2025-09-02T00:00:00Z" }),
    ];
    expect(ids(sortRows(rows, { key: "next_action_due", dir: "asc" }))).toEqual([
      "sooner",
      "later",
      "none",
    ]);
    expect(ids(sortRows(rows, { key: "created_at", dir: "desc" }))).toEqual([
      "later",
      "sooner",
      "none",
    ]);
  });

  it("sorts status by its raw value", () => {
    // `fee_type` used to be sorted here too. The Fee column left the table and
    // took its sort key with it; the fee *filter* is untouched (see above).
    const rows = [
      row({ id: "saved", status: "saved" }),
      row({ id: "applied", status: "applied" }),
      row({ id: "null", status: null }),
    ];
    expect(ids(sortRows(rows, { key: "status", dir: "asc" }))).toEqual([
      "applied",
      "saved",
      "null",
    ]);
  });
});

describe("neighborhoods", () => {
  it("is empty for no rows", () => {
    expect(neighborhoods([])).toEqual([]);
  });

  it("de-duplicates, drops blanks and sorts alphabetically", () => {
    const rows = [
      row({ id: "1", neighborhood: "Williamsburg" }),
      row({ id: "2", neighborhood: "Bushwick" }),
      row({ id: "3", neighborhood: "Williamsburg" }),
      row({ id: "4", neighborhood: null }),
      row({ id: "5", neighborhood: "" }),
      row({ id: "6", neighborhood: "Astoria" }),
    ];
    expect(neighborhoods(rows)).toEqual(["Astoria", "Bushwick", "Williamsburg"]);
  });

  it("keeps distinct casings apart, since the filter matches exactly", () => {
    const rows = [
      row({ id: "1", neighborhood: "bushwick" }),
      row({ id: "2", neighborhood: "Bushwick" }),
    ];
    expect(neighborhoods(rows)).toHaveLength(2);
  });
});

describe("filter then sort", () => {
  it("composes the way the table calls them", () => {
    const rows = [
      row({ id: "a", rent: 4000, neighborhood: "Bushwick", votes: [vote(ME, "yes")] }),
      row({ id: "b", rent: 2500, neighborhood: "Bushwick", votes: [vote(ME, "yes")] }),
      row({ id: "c", rent: 2000, neighborhood: "Astoria", votes: [vote(ME, "yes")] }),
      row({ id: "d", rent: 2600, neighborhood: "Bushwick", votes: [] }),
    ];
    const filtered = applyFilters(
      rows,
      filters({ neighborhood: "Bushwick", rentMax: "4000", myVote: "yes" }),
      ME,
    );
    expect(ids(sortRows(filtered, { key: "rent", dir: "asc" }))).toEqual(["b", "a"]);
  });
});


// -- transit to the starred place (0010) --------------------------------------

const WORK = "location-work";
const GYM = "location-gym";

function commute(
  locationId: string,
  mode: CommuteRef["mode"],
  seconds: number | null,
  error: string | null = null,
): CommuteRef {
  return { location_id: locationId, mode, seconds, error };
}

describe("transitSeconds", () => {
  it("finds the transit row for one place and ignores the others", () => {
    const listing = row({
      id: "a",
      commute_times: [
        commute(WORK, "walk", 3_000),
        commute(WORK, "transit", 1_260),
        commute(GYM, "transit", 400),
      ],
    });
    expect(transitSeconds(listing, WORK)).toBe(1_260);
    expect(transitSeconds(listing, GYM)).toBe(400);
  });

  it("is null with no starred place, no row, or a row Google refused", () => {
    const listing = row({
      id: "a",
      commute_times: [commute(WORK, "transit", null, "ZERO_RESULTS")],
    });
    expect(transitSeconds(listing, null)).toBeNull();
    expect(transitSeconds(listing, GYM)).toBeNull();
    expect(transitSeconds(listing, WORK)).toBeNull();
    expect(transitSeconds(row({ id: "b" }), WORK)).toBeNull();
  });
});

describe("sortRows — transitToPrimary", () => {
  const near = row({ id: "near", commute_times: [commute(WORK, "transit", 600)] });
  const far = row({ id: "far", commute_times: [commute(WORK, "transit", 2_400)] });
  const unknown = row({ id: "unknown", commute_times: [] });
  const refused = row({
    id: "refused",
    commute_times: [commute(WORK, "transit", null, "quota")],
  });
  const rows = [far, unknown, near, refused];

  it("puts the shortest ride first", () => {
    expect(ids(sortRows(rows, { key: "transitToPrimary", dir: "asc" }, WORK))).toEqual([
      "near",
      "far",
      "unknown",
      "refused",
    ]);
  });

  it("keeps the unanswered ones at the bottom in both directions", () => {
    const desc = ids(sortRows(rows, { key: "transitToPrimary", dir: "desc" }, WORK));
    expect(desc.slice(0, 2)).toEqual(["far", "near"]);
    expect(desc.slice(2).sort()).toEqual(["refused", "unknown"]);
  });

  it("leaves the order alone when nobody has starred a place", () => {
    expect(ids(sortRows(rows, { key: "transitToPrimary", dir: "asc" }))).toEqual(ids(rows));
  });

  it("sorts shortest-first on the first click", () => {
    expect(defaultSortDir("transitToPrimary")).toBe("asc");
  });
});

describe("matchesLinkState — what the SITE says, not what we decided", () => {
  it("lets everything past on the default", () => {
    for (const state of ["active", "off_market", "removed", "unknown", null] as const) {
      expect(matchesLinkState(state, "all")).toBe(true);
    }
  });

  it("counts both flavours of gone as gone", () => {
    expect(matchesLinkState("off_market", "gone")).toBe(true);
    expect(matchesLinkState("removed", "gone")).toBe(true);
    expect(matchesLinkState("active", "gone")).toBe(false);
    expect(matchesLinkState("unknown", "gone")).toBe(false);
    expect(matchesLinkState(null, "gone")).toBe(false);
  });

  it("counts only 'active' as live — unknown is an absence, not a yes", () => {
    expect(matchesLinkState("active", "live")).toBe(true);
    expect(matchesLinkState("unknown", "live")).toBe(false);
    expect(matchesLinkState(null, "live")).toBe(false);
  });

  it("treats a null column and 'unknown' as the same unchecked row", () => {
    expect(matchesLinkState(null, "unchecked")).toBe(true);
    expect(matchesLinkState(undefined, "unchecked")).toBe(true);
    expect(matchesLinkState("unknown", "unchecked")).toBe(true);
    expect(matchesLinkState("active", "unchecked")).toBe(false);
    expect(matchesLinkState("off_market", "unchecked")).toBe(false);
  });
});

describe("applyFilters — link state", () => {
  const rows = [
    row({ id: "live", listing_state: "active" }),
    row({ id: "gone", listing_state: "off_market" }),
    row({ id: "404", listing_state: "removed" }),
    row({ id: "shrug", listing_state: "unknown" }),
    row({ id: "never", listing_state: null }),
  ];

  it("keeps everything by default", () => {
    expect(ids(applyFilters(rows, EMPTY_FILTERS))).toEqual([
      "live",
      "gone",
      "404",
      "shrug",
      "never",
    ]);
  });

  it("narrows to the ones that vanished", () => {
    expect(ids(applyFilters(rows, filters({ linkState: "gone" })))).toEqual(["gone", "404"]);
  });

  it("narrows to the ones still up", () => {
    expect(ids(applyFilters(rows, filters({ linkState: "live" })))).toEqual(["live"]);
  });

  it("narrows to the ones nobody has looked at", () => {
    expect(ids(applyFilters(rows, filters({ linkState: "unchecked" })))).toEqual([
      "shrug",
      "never",
    ]);
  });

  it("stacks with the status filter — the two are different questions", () => {
    const mixed = [
      row({ id: "a", status: "contacted", listing_state: "off_market" }),
      row({ id: "b", status: "contacted", listing_state: "active" }),
      row({ id: "c", status: "saved", listing_state: "off_market" }),
    ];
    expect(
      ids(applyFilters(mixed, filters({ status: "contacted", linkState: "gone" }))),
    ).toEqual(["a"]);
  });
});
