import { describe, expect, it } from "vitest";
import {
  addressChanged,
  blankForMerge,
  clearVoteSummary,
  meaningfulChanges,
  voteSummary,
  type ListingPatch,
} from "./mutations";
import type { Listing } from "./types";

/**
 * `mutations.ts` is the only module that writes to Supabase, so almost all of
 * it is I/O and is covered by the app itself rather than here. Two things in
 * it are pure and decide what the *permanent* activity feed says, which makes
 * them worth pinning down:
 *
 * - `meaningfulChanges` — whether an edit deserves a feed row at all
 * - `voteSummary` — the exact wording of a vote's feed row
 *
 * The `async` writers (`createListing`, `logInteraction`, `castVote`, ...) are
 * deliberately not tested here: each is a `createClient().from(...)` chain
 * whose result is threaded into `logActivity`, so a test would have to mock the
 * whole PostgREST builder (`.from().update().eq().select().single()`) and would
 * then only assert that the mock was called the way the mock was written. The
 * summary strings they build are already covered through the two helpers above
 * plus `listingLabel` in `format.test.ts`.
 */

const BASE: Listing = {
  id: "11111111-1111-1111-1111-111111111111",
  address: "214 Grand St",
  unit: "4B",
  neighborhood: "Williamsburg",
  rent: 3200,
  beds: 2,
  baths: 1,
  sqft: 850,
  url: "https://example.com/214",
  available_date: "2025-09-01",
  fee_type: "no_fee",
  broker_fee_pct: null,
  guarantor_ok: true,
  income_multiplier: 40,
  trains: "L, G",
  notes: null,
  pets: "unknown",
  pet_notes: null,
  laundry: "unknown",
  dishwasher: "unknown",
  ac: "unknown",
  outdoor_space: "unknown",
  broker_id: null,
  added_by: null,
  status: "saved",
  listing_state: "active",
  state_checked_at: "2025-08-26T04:00:00Z",
  state_note: "streeteasy.com: price and beds still on the page",
  last_contacted_at: null,
  next_action: null,
  next_action_due: null,
  next_action_owner: null,
  next_action_owners: [],
  lat: 40.7173,
  lng: -73.95687,
  geocoded_at: "2025-08-01T00:00:05Z",
  geocode_note: "nyc-geosearch",
  dedupe_key: "214grandst|4b",
  merged_into: null,
  created_at: "2025-08-01T00:00:00Z",
  updated_at: "2025-08-01T00:00:00Z",
};

const changes = (patch: ListingPatch, prev: Listing | null = BASE) =>
  meaningfulChanges(patch, prev);

describe("meaningfulChanges — what counts as an edit", () => {
  it("is empty for a patch that changes nothing", () => {
    expect(changes({})).toEqual([]);
    expect(changes({ rent: 3200, unit: "4B", neighborhood: "Williamsburg" })).toEqual([]);
  });

  it("reports only the columns that actually moved", () => {
    expect(changes({ rent: 3300, unit: "4B" })).toEqual(["rent"]);
    expect(changes({ rent: 3300, neighborhood: "Bushwick" })).toEqual([
      "rent",
      "neighborhood",
    ]);
  });

  it("preserves the order the patch was written in", () => {
    expect(changes({ notes: "hi", rent: 1, address: "x" })).toEqual([
      "notes",
      "rent",
      "address",
    ]);
  });
});

describe("meaningfulChanges — noisy columns", () => {
  const NOISY = [
    "updated_at",
    "last_contacted_at",
    "next_action",
    "next_action_due",
    "next_action_owner",
    "next_action_owners",
  ] as const;

  /** The sync columns (0006): a robot's twice-daily look is not an edit. */
  const SYNC = ["listing_state", "state_checked_at", "state_note"] as const;

  it("never reports a follow-up column: phase 3 has its own verbs for those", () => {
    for (const column of NOISY) {
      expect(changes({ [column]: "2099-01-01" } as ListingPatch)).toEqual([]);
    }
  });

  it("never reports a sync column: that news is the listing_state_changed row", () => {
    for (const column of SYNC) {
      expect(changes({ [column]: "removed" } as ListingPatch)).toEqual([]);
    }
  });

  it("filters the noise out of a mixed patch but keeps the rest", () => {
    // `updated_at` is not even a member of `ListingPatch` (the type Omits it),
    // so the cast is the only way to hand it in — belt and braces on top of
    // the type-level exclusion.
    const patch = {
      rent: 3300,
      next_action: "Call the broker",
      next_action_due: "2025-09-05",
      updated_at: "2025-09-01T00:00:00Z",
    } as ListingPatch;
    expect(changes(patch)).toEqual(["rent"]);
  });

  it("still ignores them when prev is null", () => {
    expect(changes({ next_action: "Call", rent: 3300 }, null)).toEqual(["rent"]);
  });
});

describe("meaningfulChanges — pets", () => {
  it("treats the pet columns like any other typed-in column", () => {
    // Nothing in `meaningfulChanges` knows about `pets`: it diffs whatever is
    // in the patch minus the noisy list, so a new column is covered the day it
    // is added. This is the test that says so.
    expect(changes({ pets: "cats_only" })).toEqual(["pets"]);
    expect(changes({ pet_notes: "under 25 lb" })).toEqual(["pet_notes"]);
    expect(changes({ pets: "cats_only", pet_notes: "$500 deposit" })).toEqual([
      "pets",
      "pet_notes",
    ]);
  });

  it("does not fire when the policy is re-picked unchanged", () => {
    expect(changes({ pets: "unknown" })).toEqual([]);
    expect(changes({ pets: "unknown", pet_notes: null })).toEqual([]);
  });

  it("counts clearing the notes as an edit", () => {
    const withNotes = { ...BASE, pet_notes: "under 25 lb" };
    expect(changes({ pet_notes: null }, withNotes)).toEqual(["pet_notes"]);
    expect(changes({ pet_notes: "" }, withNotes)).toEqual(["pet_notes"]);
  });

  it("does not confuse an empty string with a null note", () => {
    // `blank()` treats both as absent, so re-saving an empty box is not an edit.
    expect(changes({ pet_notes: "" })).toEqual([]);
  });
});

describe("meaningfulChanges — loose equality", () => {
  it("does not fire on a form's string version of a number", () => {
    // react-hook-form hands back strings where the row holds numbers.
    expect(changes({ rent: "3200" as unknown as number })).toEqual([]);
    expect(changes({ beds: "2" as unknown as number })).toEqual([]);
    expect(changes({ baths: "1.0" as unknown as number })).toEqual([]);
  });

  it("still fires when the numeric value genuinely differs", () => {
    expect(changes({ rent: "3300" as unknown as number })).toEqual(["rent"]);
    expect(changes({ beds: 2.5 })).toEqual(["beds"]);
  });

  it("reports a value that cannot be read as a number at all", () => {
    expect(changes({ rent: "n/a" as unknown as number })).toEqual(["rent"]);
  });

  it("treats null, undefined and the empty string as the same nothing", () => {
    // `notes` and `broker_fee_pct` are null on BASE.
    expect(changes({ notes: "" })).toEqual([]);
    expect(changes({ notes: null })).toEqual([]);
    expect(changes({ notes: undefined })).toEqual([]);
    expect(changes({ broker_fee_pct: "" as unknown as number })).toEqual([]);
  });

  it("reports clearing a filled column, and filling an empty one", () => {
    expect(changes({ unit: "" })).toEqual(["unit"]);
    expect(changes({ unit: null })).toEqual(["unit"]);
    expect(changes({ notes: "roof deck" })).toEqual(["notes"]);
  });

  it("does not mistake a zero or a false for a blank", () => {
    expect(changes({ rent: 0 })).toEqual(["rent"]);
    expect(changes({ broker_fee_pct: 0 })).toEqual(["broker_fee_pct"]);
    expect(changes({ guarantor_ok: false })).toEqual(["guarantor_ok"]);
    expect(changes({ guarantor_ok: true })).toEqual([]);
  });

  it("treats a status change as an ordinary edit here", () => {
    // `setListingStatus` has its own verb; this is the inline-edit path.
    expect(changes({ status: "contacted" })).toEqual(["status"]);
    expect(changes({ status: "saved" })).toEqual([]);
  });
});

describe("meaningfulChanges — no previous row", () => {
  it("reports every non-blank column when prev is null", () => {
    expect(changes({ address: "1 Main St", rent: 2000 }, null)).toEqual([
      "address",
      "rent",
    ]);
  });

  it("still drops blanks when prev is null, since blank equals missing", () => {
    // Note: `updateListing(…, prev = null)` bypasses this helper on purpose to
    // force a feed entry. This is the helper's own rule, not that path's.
    expect(changes({ notes: "", unit: null, rent: 2000 }, null)).toEqual(["rent"]);
  });
});

describe("meaningfulChanges — amenities", () => {
  it("treats the four amenity columns like any other typed-in column", () => {
    expect(changes({ laundry: "in_unit" })).toEqual(["laundry"]);
    expect(changes({ dishwasher: "yes" })).toEqual(["dishwasher"]);
    expect(changes({ ac: "window" })).toEqual(["ac"]);
    expect(changes({ outdoor_space: "private" })).toEqual(["outdoor_space"]);
  });

  it("says nothing when a patch re-states the `unknown` default", () => {
    expect(
      changes({
        laundry: "unknown",
        dishwasher: "unknown",
        ac: "unknown",
        outdoor_space: "unknown",
      }),
    ).toEqual([]);
  });
});

describe("blankForMerge — what the merge backfill may overwrite", () => {
  /**
   * The mirror of the `case` arms in `merge_listings` (0005 for `pets`, 0009
   * for the amenities). If these two ever disagree, the "merge into it" path in
   * the add dialog and the RPC behind the detail page's Merge button start
   * producing different rows for the same duplicate.
   */
  const UNKNOWN_COLUMNS = ["pets", "laundry", "dishwasher", "ac", "outdoor_space"];

  it("reads `unknown` as an absence on every column that defaults to it", () => {
    for (const column of UNKNOWN_COLUMNS) {
      expect(blankForMerge(column, "unknown")).toBe(true);
    }
  });

  it("reads a real answer as an answer", () => {
    expect(blankForMerge("pets", "cats_only")).toBe(false);
    expect(blankForMerge("laundry", "in_unit")).toBe(false);
    expect(blankForMerge("laundry", "none")).toBe(false);
    expect(blankForMerge("dishwasher", "no")).toBe(false);
    expect(blankForMerge("ac", "window")).toBe(false);
    expect(blankForMerge("outdoor_space", "shared")).toBe(false);
  });

  it("still treats null, undefined and the empty string as blank anywhere", () => {
    for (const column of [...UNKNOWN_COLUMNS, "rent", "notes", "url"]) {
      expect(blankForMerge(column, null)).toBe(true);
      expect(blankForMerge(column, undefined)).toBe(true);
      expect(blankForMerge(column, "")).toBe(true);
    }
  });

  it("does not extend the `unknown` rule to columns that never default to it", () => {
    // "unknown" is a legitimate string for a free-text column, and treating it
    // as blank there would let a merge silently overwrite what somebody typed.
    expect(blankForMerge("notes", "unknown")).toBe(false);
    expect(blankForMerge("neighborhood", "unknown")).toBe(false);
  });
});

describe("voteSummary", () => {
  const L = "214 Grand St #4B";

  it("words a first vote", () => {
    expect(voteSummary(L, "yes", null, null)).toBe(`voted yes on ${L}`);
    expect(voteSummary(L, "no", null, null)).toBe(`voted no on ${L}`);
    expect(voteSummary(L, "maybe", null, null)).toBe(`voted maybe on ${L}`);
  });

  it("words a changed vote", () => {
    expect(voteSummary(L, "maybe", null, { vote: "yes", comment: null })).toBe(
      `changed vote to maybe on ${L}`,
    );
    expect(voteSummary(L, "yes", null, { vote: "no", comment: null })).toBe(
      `changed vote to yes on ${L}`,
    );
  });

  it("words a withdrawal", () => {
    expect(voteSummary(L, null, null, { vote: "yes", comment: null })).toBe(
      `withdrew vote on ${L}`,
    );
  });

  it("words a new comment on an unchanged vote", () => {
    expect(voteSummary(L, "yes", "too far from the L", { vote: "yes", comment: null })).toBe(
      `commented on their vote for ${L}`,
    );
  });

  it("words a comment left without taking a side", () => {
    expect(voteSummary(L, null, "who is the broker?", { vote: null, comment: null })).toBe(
      `commented on ${L}`,
    );
  });

  it("stays silent when a comment input blurs untouched", () => {
    // SPEC: log impressions, not observations.
    expect(voteSummary(L, "yes", "same text", { vote: "yes", comment: "same text" })).toBeNull();
    expect(voteSummary(L, "yes", null, { vote: "yes", comment: null })).toBeNull();
    expect(voteSummary(L, null, null, { vote: null, comment: null })).toBeNull();
  });

  it("ignores whitespace-only differences in a comment", () => {
    expect(voteSummary(L, "yes", "  same text  ", { vote: "yes", comment: "same text" })).toBeNull();
    expect(voteSummary(L, "yes", "   ", { vote: "yes", comment: null })).toBeNull();
    expect(voteSummary(L, "yes", "", { vote: "yes", comment: null })).toBeNull();
  });

  it("notices a comment being deleted", () => {
    expect(voteSummary(L, "yes", null, { vote: "yes", comment: "old note" })).toBe(
      `commented on their vote for ${L}`,
    );
  });

  it("treats an undefined prev as 'unknown', which forces an entry", () => {
    // Documented escape hatch: pass `undefined` when the caller has not read
    // the previous vote and would rather over-report than lose the impression.
    expect(voteSummary(L, "yes", null, undefined)).toBe(`voted yes on ${L}`);
    expect(voteSummary(L, null, null, undefined)).toBe(`commented on ${L}`);
    expect(voteSummary(L, null, "hello", undefined)).toBe(`commented on ${L}`);
  });

  it("treats a null prev as 'no vote yet' and an undefined prev as 'unknown'", () => {
    // The difference only shows on a no-op. null is a *known* absence, so
    // nothing happened and nothing is logged...
    expect(voteSummary(L, null, null, null)).toBeNull();
    expect(voteSummary(L, null, null, { vote: null, comment: null })).toBeNull();
    // ...while undefined means the caller never read the previous vote, so the
    // impression is logged rather than lost.
    expect(voteSummary(L, null, null, undefined)).toBe(`commented on ${L}`);
  });

  it("carries the label through verbatim, however odd it is", () => {
    expect(voteSummary("(no address)", "yes", null, null)).toBe("voted yes on (no address)");
  });
});

describe("clearVoteSummary", () => {
  const L = "214 Grand St #4B";

  it("says 'withdrew vote' when a side was actually taken", () => {
    expect(clearVoteSummary(L, { vote: "yes", comment: null })).toBe(`withdrew vote on ${L}`);
    expect(clearVoteSummary(L, { vote: "no", comment: "too far" })).toBe(
      `withdrew vote on ${L}`,
    );
  });

  it("says 'removed their comment' for a row that only ever held text", () => {
    // `castVote` keeps a row with `vote: null` so a comment survives without
    // taking a side. Calling that deletion a withdrawn vote was a lie in the
    // feed — there was never a vote to withdraw.
    expect(clearVoteSummary(L, { vote: null, comment: "asked about the fee" })).toBe(
      `removed their comment on ${L}`,
    );
  });

  it("logs nothing when the delete removed nothing", () => {
    // Clear on a listing this person never voted on: no row came back, so no
    // impression happened and the feed stays quiet.
    expect(clearVoteSummary(L, undefined)).toBeNull();
    expect(clearVoteSummary(L, null)).toBeNull();
  });

  it("logs nothing for a row that was empty on both counts", () => {
    expect(clearVoteSummary(L, { vote: null, comment: null })).toBeNull();
    expect(clearVoteSummary(L, { vote: null, comment: "" })).toBeNull();
    // Whitespace is not a comment.
    expect(clearVoteSummary(L, { vote: null, comment: "   " })).toBeNull();
  });

  it("prefers the vote wording when the row had both", () => {
    expect(clearVoteSummary(L, { vote: "maybe", comment: "on the fence" })).toBe(
      `withdrew vote on ${L}`,
    );
  });

  it("carries the label through verbatim", () => {
    expect(clearVoteSummary("(no address)", { vote: "yes", comment: null })).toBe(
      "withdrew vote on (no address)",
    );
  });
});

describe("addressChanged — when the map has to catch up", () => {
  it("is false for an edit that never mentions the address", () => {
    expect(addressChanged({ rent: 3400 }, BASE)).toBe(false);
    expect(addressChanged({ notes: "ask about the boiler" }, BASE)).toBe(false);
  });

  it("is false when the address is sent back unchanged", () => {
    // The detail page's inline edits submit the field they own, blur or no
    // blur; re-geocoding on every one of those would be a lookup per keystroke.
    expect(addressChanged({ address: "214 Grand St" }, BASE)).toBe(false);
    expect(addressChanged({ address: "214 Grand St", unit: "4B" }, BASE)).toBe(false);
  });

  it("is true when the street changes", () => {
    expect(addressChanged({ address: "216 Grand St" }, BASE)).toBe(true);
  });

  it("is true when only the unit changes", () => {
    // A unit is not a new building, but the trigger clears the pin either way
    // (0010) and a listing with no pin is a listing off the map.
    expect(addressChanged({ unit: "5C" }, BASE)).toBe(true);
    expect(addressChanged({ unit: null }, BASE)).toBe(true);
  });

  it("is true with no previous row to compare against", () => {
    expect(addressChanged({ address: "214 Grand St" }, null)).toBe(true);
    expect(addressChanged({ rent: 3400 }, null)).toBe(false);
  });
});

describe("meaningfulChanges — the map pin", () => {
  it("reads a moved pin as one field, not four", () => {
    expect(
      changes({
        lat: 40.72,
        lng: -73.95,
        geocoded_at: "2026-01-01T00:00:00Z",
        geocode_note: "manual",
      }),
    ).toEqual(["lat"]);
  });

  it("says nothing when the geocoder confirms where it already was", () => {
    expect(changes({ lat: 40.7173, lng: -73.95687, geocode_note: "nominatim" })).toEqual([]);
  });
});
