import { describe, expect, it } from "vitest";
import {
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
  broker_id: null,
  added_by: null,
  status: "saved",
  last_contacted_at: null,
  next_action: null,
  next_action_due: null,
  next_action_owner: null,
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
  ] as const;

  it("never reports a follow-up column: phase 3 has its own verbs for those", () => {
    for (const column of NOISY) {
      expect(changes({ [column]: "2099-01-01" } as ListingPatch)).toEqual([]);
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
