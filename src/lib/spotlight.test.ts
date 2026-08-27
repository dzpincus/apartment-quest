import { describe, expect, it } from "vitest";
import {
  SPOTLIGHT_NOTE_MAX,
  SUMMARY_NOTE_MAX,
  activeSpotlights,
  mySpotlight,
  spotlightSummary,
  type SpotlightSource,
} from "./spotlight";
import type { ListingStatus, Uuid } from "./types";

/**
 * The three helpers behind "Look at this one!". Everything that decides whether
 * a spotlight is drawn lives here rather than in the strip, because "a listing
 * we passed on quietly stops shouting" is a rule, not a rendering detail.
 */

const DYLAN = "11111111-0000-0000-0000-000000000001";
const REESE = "22222222-0000-0000-0000-000000000002";
const BRENNA = "33333333-0000-0000-0000-000000000003";
const BOT = "99999999-0000-0000-0000-000000000009";

const people = [
  { id: DYLAN, key: "dylan", name: "Dylan" },
  { id: REESE, key: "reese", name: "Reese" },
  { id: BRENNA, key: "brenna", name: "Brenna" },
  { id: BOT, key: "bot", name: "Quest Bot" },
];

type Row = SpotlightSource & { id: Uuid };

function row(
  id: string,
  spotlights: Array<{ person_id: Uuid; note?: string | null; created_at: string }>,
  over: Partial<Row> = {},
): Row {
  return {
    id,
    status: "saved" as ListingStatus,
    merged_into: null,
    spotlights: spotlights.map((s) => ({
      person_id: s.person_id,
      note: s.note ?? null,
      created_at: s.created_at,
    })),
    ...over,
  };
}

const ids = (list: Array<{ listing: Row }>) => list.map((s) => s.listing.id);
const owners = (list: Array<{ person: { id: Uuid } }>) => list.map((s) => s.person.id);

describe("activeSpotlights", () => {
  it("pairs each spotlight with the person who set it", () => {
    const rows = [row("a", [{ person_id: DYLAN, note: "great light", created_at: "2026-08-01T12:00:00Z" }])];
    const [only] = activeSpotlights(rows, people);
    expect(only.person.id).toBe(DYLAN);
    expect(only.listing.id).toBe("a");
    expect(only.note).toBe("great light");
    expect(only.created_at).toBe("2026-08-01T12:00:00Z");
  });

  it("orders newest first", () => {
    const rows = [
      row("old", [{ person_id: DYLAN, created_at: "2026-08-01T12:00:00Z" }]),
      row("new", [{ person_id: REESE, created_at: "2026-08-05T12:00:00Z" }]),
      row("mid", [{ person_id: BRENNA, created_at: "2026-08-03T12:00:00Z" }]),
    ];
    expect(ids(activeSpotlights(rows, people))).toEqual(["new", "mid", "old"]);
  });

  it("drops a listing somebody passed on or lost", () => {
    // A dead listing is not something to look at, and nothing was deleted to
    // make that true: un-passing it brings the spotlight straight back.
    for (const status of ["passed", "lost"] as ListingStatus[]) {
      const rows = [
        row("dead", [{ person_id: DYLAN, created_at: "2026-08-01T12:00:00Z" }], { status }),
      ];
      expect(activeSpotlights(rows, people)).toEqual([]);
    }
  });

  it("keeps every status that is still in play", () => {
    const alive: ListingStatus[] = [
      "saved",
      "contacted",
      "tour_scheduled",
      "toured",
      "applied",
    ];
    for (const status of alive) {
      const rows = [
        row("live", [{ person_id: DYLAN, created_at: "2026-08-01T12:00:00Z" }], { status }),
      ];
      expect(ids(activeSpotlights(rows, people))).toEqual(["live"]);
    }
  });

  it("drops a listing that was merged into another", () => {
    const rows = [
      row("dupe", [{ person_id: DYLAN, created_at: "2026-08-01T12:00:00Z" }], {
        merged_into: "aaaa",
      }),
    ];
    expect(activeSpotlights(rows, people)).toEqual([]);
  });

  it("never lets Quest Bot shout", () => {
    // The bot signs listing-state changes; it has never been in an apartment.
    const rows = [
      row("a", [
        { person_id: BOT, note: "looks gone", created_at: "2026-08-09T12:00:00Z" },
        { person_id: DYLAN, created_at: "2026-08-01T12:00:00Z" },
      ]),
    ];
    expect(owners(activeSpotlights(rows, people))).toEqual([DYLAN]);
  });

  it("ignores a spotlight whose person is not on the roster", () => {
    // A deleted housemate cascades in the database; this is what a stale cache
    // entry between the two reads looks like.
    const rows = [row("a", [{ person_id: "ghost", created_at: "2026-08-01T12:00:00Z" }])];
    expect(activeSpotlights(rows, people)).toEqual([]);
  });

  it("keeps at most one per person, the newest", () => {
    // `person_id` is the primary key, so the database cannot produce this. A
    // cache holding both halves of an in-flight replace can.
    const rows = [
      row("older", [{ person_id: DYLAN, note: "first", created_at: "2026-08-01T12:00:00Z" }]),
      row("newer", [{ person_id: DYLAN, note: "second", created_at: "2026-08-06T12:00:00Z" }]),
    ];
    const active = activeSpotlights(rows, people);
    expect(active).toHaveLength(1);
    expect(active[0].listing.id).toBe("newer");
    expect(active[0].note).toBe("second");
  });

  it("trims the note and treats whitespace as no note at all", () => {
    const rows = [
      row("a", [{ person_id: DYLAN, note: "  roof deck  ", created_at: "2026-08-01T12:00:00Z" }]),
      row("b", [{ person_id: REESE, note: "   ", created_at: "2026-08-02T12:00:00Z" }]),
    ];
    const active = activeSpotlights(rows, people);
    expect(active.find((s) => s.listing.id === "a")?.note).toBe("roof deck");
    expect(active.find((s) => s.listing.id === "b")?.note).toBeNull();
  });

  it("is total: no rows, no people, no embed", () => {
    expect(activeSpotlights([], people)).toEqual([]);
    expect(activeSpotlights(null, people)).toEqual([]);
    expect(activeSpotlights(undefined, undefined)).toEqual([]);
    expect(activeSpotlights([row("a", [])], [])).toEqual([]);
    expect(
      activeSpotlights(
        [{ id: "a", status: "saved", merged_into: null } as unknown as Row],
        people,
      ),
    ).toEqual([]);
  });

  it("sorts unparseable timestamps last rather than throwing them at NaN", () => {
    const rows = [
      row("broken", [{ person_id: DYLAN, created_at: "not a date" }]),
      row("real", [{ person_id: REESE, created_at: "2026-08-01T12:00:00Z" }]),
    ];
    expect(ids(activeSpotlights(rows, people))).toEqual(["real", "broken"]);
  });

  it("breaks a tie on person id, so the order does not flap between renders", () => {
    const same = "2026-08-01T12:00:00Z";
    const rows = [
      row("b", [{ person_id: REESE, created_at: same }]),
      row("a", [{ person_id: DYLAN, created_at: same }]),
    ];
    expect(owners(activeSpotlights(rows, people))).toEqual([DYLAN, REESE]);
    expect(owners(activeSpotlights([...rows].reverse(), people))).toEqual([DYLAN, REESE]);
  });
});

describe("mySpotlight", () => {
  const rows = [
    row("a", [{ person_id: REESE, note: "hers", created_at: "2026-08-01T12:00:00Z" }]),
    row("b", [{ person_id: DYLAN, note: " mine ", created_at: "2026-08-02T12:00:00Z" }]),
  ];

  it("finds the row this person is pointing at", () => {
    expect(mySpotlight(rows, DYLAN)).toEqual({ listing: rows[1], note: "mine" });
  });

  it("is null for a person with none, and for no person at all", () => {
    expect(mySpotlight(rows, BRENNA)).toBeNull();
    expect(mySpotlight(rows, null)).toBeNull();
    expect(mySpotlight(rows, undefined)).toBeNull();
    expect(mySpotlight(null, DYLAN)).toBeNull();
  });

  it("still finds a spotlight on a listing Home would hide", () => {
    // The slot is occupied whatever the status: the dialog has to be able to
    // say "this replaces your spotlight on X" and to offer to take it down.
    const dead = [
      row("dead", [{ person_id: DYLAN, note: "was nice", created_at: "2026-08-02T12:00:00Z" }], {
        status: "passed",
      }),
    ];
    expect(activeSpotlights(dead, people)).toEqual([]);
    expect(mySpotlight(dead, DYLAN)?.listing.id).toBe("dead");
  });

  it("reads a whitespace-only note as no note", () => {
    const blank = [row("a", [{ person_id: DYLAN, note: "\n ", created_at: "2026-08-02T12:00:00Z" }])];
    expect(mySpotlight(blank, DYLAN)?.note).toBeNull();
  });
});

describe("spotlightSummary", () => {
  const label = "214 Grand St #4B";

  it("quotes the reason", () => {
    expect(spotlightSummary("set", label, "great light, no fee")).toBe(
      `spotlighted ${label} — “great light, no fee”`,
    );
  });

  it("says only what happened when there is no reason", () => {
    for (const note of [null, undefined, "", "   "]) {
      expect(spotlightSummary("set", label, note)).toBe(`spotlighted ${label}`);
    }
  });

  it("trims the reason", () => {
    expect(spotlightSummary("set", label, "  roof deck  ")).toBe(
      `spotlighted ${label} — “roof deck”`,
    );
  });

  it("words a removal as a removal", () => {
    expect(spotlightSummary("clear", label, null)).toBe(`took the spotlight off ${label}`);
    // The note is irrelevant to a removal — there is nothing left to quote.
    expect(spotlightSummary("clear", label, "great light")).toBe(
      `took the spotlight off ${label}`,
    );
  });

  it("caps a long reason with an ellipsis, counting the ellipsis", () => {
    const long = "x".repeat(SPOTLIGHT_NOTE_MAX);
    const summary = spotlightSummary("set", label, long);
    const quote = summary.slice(summary.indexOf("“") + 1, summary.lastIndexOf("”"));
    expect(quote.length).toBe(SUMMARY_NOTE_MAX);
    expect(quote.endsWith("…")).toBe(true);
  });

  it("does not cut a reason that fits", () => {
    const fits = "y".repeat(SUMMARY_NOTE_MAX);
    expect(spotlightSummary("set", label, fits)).toBe(`spotlighted ${label} — “${fits}”`);
  });

  it("does not leave a space before the ellipsis", () => {
    // Slicing mid-sentence lands on a space as often as not; "word …" reads as
    // a typo rather than as a cut.
    const note = `${"a".repeat(SUMMARY_NOTE_MAX - 2)} tail`;
    const summary = spotlightSummary("set", label, note);
    expect(summary).not.toContain(" …");
  });

  it("is a verb phrase, never the actor's name", () => {
    // The feed prints the person in their own colour beside the line.
    for (const action of ["set", "clear"] as const) {
      expect(spotlightSummary(action, label, "why")).toMatch(/^[a-z]/);
    }
  });
});
