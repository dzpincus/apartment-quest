import { describe, expect, it } from "vitest";
import {
  findVote,
  matchesMyVote,
  myVote,
  upsertVote,
  voteCounts,
  voteScore,
  voteTooltip,
  withoutVote,
} from "./votes";
import type { VoteRow } from "./queries";
import type { VoteValue } from "./types";

function vote(
  personId: string,
  value: VoteValue | null,
  comment: string | null = null,
): VoteRow {
  return {
    person_id: personId,
    vote: value,
    comment,
    updated_at: "2025-08-27T18:00:00Z",
  };
}

describe("voteCounts", () => {
  it("is all zeroes for no votes at all", () => {
    expect(voteCounts(undefined)).toEqual({ yes: 0, maybe: 0, no: 0, total: 0 });
    expect(voteCounts([])).toEqual({ yes: 0, maybe: 0, no: 0, total: 0 });
  });

  it("counts each value and the total", () => {
    const counts = voteCounts([
      vote("dylan", "yes"),
      vote("reese", "yes"),
      vote("brenna", "maybe"),
      vote("kathryn", "no"),
    ]);
    expect(counts).toEqual({ yes: 2, maybe: 1, no: 1, total: 4 });
  });

  it("ignores a comment-only row with no vote", () => {
    const counts = voteCounts([vote("dylan", null, "need to see it first")]);
    expect(counts).toEqual({ yes: 0, maybe: 0, no: 0, total: 0 });
  });
});

describe("voteScore", () => {
  it("ranks more yeses first", () => {
    const two = voteScore([vote("a", "yes"), vote("b", "yes")]);
    const one = voteScore([vote("a", "yes")]);
    expect(two).toBeGreaterThan(one);
  });

  it("breaks a tie on yeses by fewest nos", () => {
    const clean = voteScore([vote("a", "yes"), vote("b", "maybe")]);
    const contested = voteScore([vote("a", "yes"), vote("b", "no")]);
    expect(clean).toBeGreaterThan(contested);
  });

  it("never lets nos outweigh a yes, even at four people", () => {
    const oneYesThreeNos = voteScore([
      vote("a", "yes"),
      vote("b", "no"),
      vote("c", "no"),
      vote("d", "no"),
    ]);
    const noVotesAtAll = voteScore([]);
    expect(oneYesThreeNos).toBeGreaterThan(noVotesAtAll);
  });

  it("sorts a table descending the way the column promises", () => {
    const rows = [
      { id: "none", votes: [] as VoteRow[] },
      { id: "split", votes: [vote("a", "yes"), vote("b", "no")] },
      { id: "loved", votes: [vote("a", "yes"), vote("b", "yes")] },
      { id: "liked", votes: [vote("a", "yes"), vote("b", "maybe")] },
    ];
    const order = [...rows]
      .sort((x, y) => voteScore(y.votes) - voteScore(x.votes))
      .map((r) => r.id);
    expect(order).toEqual(["loved", "liked", "split", "none"]);
  });
});

describe("findVote / myVote", () => {
  const rows = [vote("dylan", "yes", "great light"), vote("reese", "no")];

  it("finds a person's row and value", () => {
    expect(findVote(rows, "dylan")?.comment).toBe("great light");
    expect(myVote(rows, "reese")).toBe("no");
  });

  it("is null for someone who has not voted, or for no person at all", () => {
    expect(findVote(rows, "brenna")).toBeNull();
    expect(myVote(rows, undefined)).toBeNull();
  });
});

describe("matchesMyVote", () => {
  const rows = [vote("dylan", "yes"), vote("reese", "maybe")];

  it("passes everything when the filter is off", () => {
    expect(matchesMyVote(rows, "brenna", "all")).toBe(true);
  });

  it("matches on the person's own value only", () => {
    expect(matchesMyVote(rows, "dylan", "yes")).toBe(true);
    expect(matchesMyVote(rows, "dylan", "no")).toBe(false);
    expect(matchesMyVote(rows, "reese", "maybe")).toBe(true);
  });

  it("'none' means the person has no vote on this listing", () => {
    expect(matchesMyVote(rows, "brenna", "none")).toBe(true);
    expect(matchesMyVote(rows, "dylan", "none")).toBe(false);
    expect(matchesMyVote([], "dylan", "none")).toBe(true);
  });

  it("hides nothing when nobody has picked who they are yet", () => {
    expect(matchesMyVote(rows, null, "yes")).toBe(true);
  });
});

describe("upsertVote / withoutVote", () => {
  const rows = [vote("dylan", "yes"), vote("reese", "no")];

  it("replaces a row in place rather than moving it", () => {
    const next = upsertVote(rows, vote("dylan", "maybe", "on the fence"));
    expect(next.map((v) => v.person_id)).toEqual(["dylan", "reese"]);
    expect(next[0].vote).toBe("maybe");
    expect(next[0].comment).toBe("on the fence");
  });

  it("appends a first-time voter", () => {
    const next = upsertVote(rows, vote("brenna", "yes"));
    expect(next).toHaveLength(3);
    expect(next[2].person_id).toBe("brenna");
  });

  it("does not mutate the array it was given", () => {
    upsertVote(rows, vote("dylan", "no"));
    expect(rows[0].vote).toBe("yes");
  });

  it("drops one person's row and leaves the rest", () => {
    expect(withoutVote(rows, "dylan").map((v) => v.person_id)).toEqual(["reese"]);
    expect(withoutVote(undefined, "dylan")).toEqual([]);
  });
});

describe("voteTooltip", () => {
  it("lists who voted what, with comments, skipping comment-only rows", () => {
    const text = voteTooltip(
      [vote("dylan", "yes", "great light"), vote("reese", "no"), vote("brenna", null, "hm")],
      (id) => ({ dylan: "Dylan", reese: "Reese" })[id],
    );
    expect(text).toBe("Dylan: Yes — great light\nReese: No");
  });

  it("is empty when nobody has voted", () => {
    expect(voteTooltip([], () => "Dylan")).toBe("");
    expect(voteTooltip(null, () => "Dylan")).toBe("");
    expect(voteTooltip(undefined, () => "Dylan")).toBe("");
    expect(voteTooltip([vote("dylan", null, "just a note")], () => "Dylan")).toBe("");
  });

  it("falls back to 'Someone' for a person it cannot name", () => {
    // A vote from a person row this device has not loaded yet.
    expect(voteTooltip([vote("ghost", "yes")], () => undefined)).toBe("Someone: Yes");
  });

  it("ignores a whitespace-only comment", () => {
    expect(voteTooltip([vote("dylan", "yes", "   ")], () => "Dylan")).toBe("Dylan: Yes");
    expect(voteTooltip([vote("dylan", "yes", "")], () => "Dylan")).toBe("Dylan: Yes");
  });

  it("trims a comment rather than printing its padding", () => {
    expect(voteTooltip([vote("dylan", "yes", "  bright  ")], () => "Dylan")).toBe(
      "Dylan: Yes — bright",
    );
  });

  it("keeps the rows in the order it was given", () => {
    const text = voteTooltip(
      [vote("c", "no"), vote("a", "yes"), vote("b", "maybe")],
      (id) => id.toUpperCase(),
    );
    expect(text).toBe("C: No\nA: Yes\nB: Maybe");
  });
});

describe("null and empty inputs", () => {
  it("every helper tolerates a null or undefined votes array", () => {
    expect(voteCounts(null)).toEqual({ yes: 0, maybe: 0, no: 0, total: 0 });
    expect(voteCounts([])).toEqual({ yes: 0, maybe: 0, no: 0, total: 0 });
    expect(voteScore(null)).toBe(0);
    expect(voteScore([])).toBe(0);
    expect(findVote(null, "dylan")).toBeNull();
    expect(myVote(null, "dylan")).toBeNull();
    expect(upsertVote(null, vote("dylan", "yes"))).toEqual([vote("dylan", "yes")]);
    expect(withoutVote(null, "dylan")).toEqual([]);
    expect(matchesMyVote(null, "dylan", "none")).toBe(true);
  });

  it("ignores a vote value the schema should have rejected", () => {
    // A CHECK constraint guards the column, but a client must not throw if a
    // row ever arrives with something else in it.
    const rogue = { ...vote("dylan", null), vote: "abstain" as unknown as VoteValue };
    expect(voteCounts([rogue])).toEqual({ yes: 0, maybe: 0, no: 0, total: 0 });
    expect(voteScore([rogue])).toBe(0);
    expect(voteTooltip([rogue], () => "Dylan")).toBe("Dylan: undefined");
  });
});

describe("voteScore — ties", () => {
  it("gives two rows with the same yes and no counts the same score", () => {
    const a = [vote("p1", "yes"), vote("p2", "maybe")];
    const b = [vote("p3", "yes"), vote("p4", "maybe")];
    expect(voteScore(a)).toBe(voteScore(b));
  });

  it("does not let maybes move the score at all", () => {
    expect(voteScore([vote("p1", "yes")])).toBe(
      voteScore([vote("p1", "yes"), vote("p2", "maybe"), vote("p3", "maybe")]),
    );
  });

  it("scores an all-maybe row the same as silence", () => {
    expect(voteScore([vote("p1", "maybe"), vote("p2", "maybe")])).toBe(voteScore([]));
  });

  it("goes negative only when there are nos and no yeses", () => {
    expect(voteScore([vote("p1", "no")])).toBe(-1);
    expect(voteScore([vote("p1", "no"), vote("p2", "no")])).toBe(-2);
    expect(voteScore([vote("p1", "yes"), vote("p2", "no")])).toBe(9);
  });
});

describe("upsertVote / withoutVote — edges", () => {
  it("replacing the only row keeps the length at one", () => {
    const rows = [vote("dylan", "yes")];
    expect(upsertVote(rows, vote("dylan", "no"))).toEqual([vote("dylan", "no")]);
  });

  it("removing someone who never voted is a no-op copy", () => {
    const rows = [vote("dylan", "yes")];
    const out = withoutVote(rows, "nobody");
    expect(out).toEqual(rows);
    expect(out).not.toBe(rows);
  });

  it("appends to an empty array rather than throwing", () => {
    expect(upsertVote([], vote("dylan", "yes"))).toEqual([vote("dylan", "yes")]);
  });
});

describe("matchesMyVote — edges", () => {
  it("keeps everything when the filter is off, even with no votes and no person", () => {
    expect(matchesMyVote(null, null, "all")).toBe(true);
    expect(matchesMyVote([], null, "all")).toBe(true);
  });

  it("counts a comment-only row as 'not voted'", () => {
    const rows = [vote("dylan", null, "hm")];
    expect(matchesMyVote(rows, "dylan", "none")).toBe(true);
    expect(matchesMyVote(rows, "dylan", "yes")).toBe(false);
  });

  it("matches every value against itself and nothing else", () => {
    for (const value of ["yes", "no", "maybe"] as VoteValue[]) {
      const rows = [vote("dylan", value)];
      expect(matchesMyVote(rows, "dylan", value)).toBe(true);
      expect(matchesMyVote(rows, "dylan", "none")).toBe(false);
      for (const other of ["yes", "no", "maybe"] as VoteValue[]) {
        if (other !== value) expect(matchesMyVote(rows, "dylan", other)).toBe(false);
      }
    }
  });
});
