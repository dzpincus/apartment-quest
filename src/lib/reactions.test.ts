import { describe, expect, it } from "vitest";
import {
  groupReactions,
  hasReaction,
  REACTION_EMOJI,
  toggleReactionPatch,
  type ReactionLike,
} from "./reactions";

const ME = "me-0000-0000-0000-000000000001";
const YOU = "you-0000-0000-0000-000000000002";
const THEM = "them-0000-0000-0000-000000000003";

const r = (person_id: string, emoji: string): ReactionLike => ({ person_id, emoji });

describe("groupReactions", () => {
  it("returns nothing for nothing", () => {
    expect(groupReactions([], ME)).toEqual([]);
    expect(groupReactions(null, ME)).toEqual([]);
    expect(groupReactions(undefined, ME)).toEqual([]);
  });

  it("collapses one emoji into one chip with a count", () => {
    expect(groupReactions([r(ME, "👍"), r(YOU, "👍"), r(THEM, "👍")], ME)).toEqual([
      { emoji: "👍", count: 3, mine: true, personIds: [ME, YOU, THEM] },
    ]);
  });

  it("marks `mine` only for this person", () => {
    const groups = groupReactions([r(YOU, "👍"), r(THEM, "🔥")], ME);
    expect(groups.map((g) => g.mine)).toEqual([false, false]);
    expect(groupReactions([r(YOU, "👍")], YOU)[0].mine).toBe(true);
  });

  it("treats a missing person as nobody's reaction", () => {
    expect(groupReactions([r(ME, "👍")], null)[0].mine).toBe(false);
    expect(groupReactions([r(ME, "👍")], undefined)[0].mine).toBe(false);
  });

  it("orders by the palette, not by arrival", () => {
    // 😬 is last in the palette and first in the data.
    const groups = groupReactions([r(ME, "😬"), r(YOU, "❤️"), r(THEM, "👍")], ME);
    expect(groups.map((g) => g.emoji)).toEqual(["👍", "❤️", "😬"]);
  });

  it("keeps every palette emoji in the declared order", () => {
    const all = REACTION_EMOJI.map((emoji) => r(ME, emoji));
    const shuffled = [...all].reverse();
    expect(groupReactions(shuffled, ME).map((g) => g.emoji)).toEqual([...REACTION_EMOJI]);
  });

  it("puts an emoji outside the palette after it, in first-appearance order", () => {
    const groups = groupReactions(
      [r(ME, "🎉"), r(YOU, "🥲"), r(THEM, "👍")],
      ME,
    );
    expect(groups.map((g) => g.emoji)).toEqual(["👍", "🎉", "🥲"]);
  });

  it("counts people, not rows: a duplicate row cannot inflate a chip", () => {
    // The primary key forbids this; the grouping does not have to trust it.
    const groups = groupReactions([r(ME, "👍"), r(ME, "👍"), r(YOU, "👍")], ME);
    expect(groups[0]).toEqual({
      emoji: "👍",
      count: 2,
      mine: true,
      personIds: [ME, YOU],
    });
  });

  it("skips a row with no emoji rather than drawing an empty chip", () => {
    expect(groupReactions([r(ME, ""), r(YOU, "👍")], ME).map((g) => g.emoji)).toEqual([
      "👍",
    ]);
  });

  it("does not mutate its input", () => {
    const rows = [r(ME, "😬"), r(YOU, "👍")];
    const copy = structuredClone(rows);
    groupReactions(rows, ME);
    expect(rows).toEqual(copy);
  });
});

describe("toggleReactionPatch", () => {
  const messages = [
    { id: "m1", reactions: [r(YOU, "👍")] },
    { id: "m2", reactions: [] as ReactionLike[] },
    { id: "m3", reactions: null },
  ];

  it("adds a reaction this person did not have", () => {
    const next = toggleReactionPatch(messages, "m1", ME, "👍");
    expect(next[0].reactions).toEqual([r(YOU, "👍"), r(ME, "👍")]);
  });

  it("removes the one they did", () => {
    const next = toggleReactionPatch(messages, "m1", YOU, "👍");
    expect(next[0].reactions).toEqual([]);
  });

  it("only removes the exact (person, emoji) pair", () => {
    const rows = [{ id: "m1", reactions: [r(ME, "👍"), r(ME, "🔥"), r(YOU, "👍")] }];
    const next = toggleReactionPatch(rows, "m1", ME, "👍");
    expect(next[0].reactions).toEqual([r(ME, "🔥"), r(YOU, "👍")]);
  });

  it("handles a message with no reactions array at all", () => {
    const next = toggleReactionPatch(messages, "m3", ME, "❤️");
    expect(next[2].reactions).toEqual([r(ME, "❤️")]);
  });

  it("is its own inverse", () => {
    const once = toggleReactionPatch(messages, "m2", ME, "🔥");
    const twice = toggleReactionPatch(once, "m2", ME, "🔥");
    expect(twice[1].reactions).toEqual([]);
  });

  it("leaves every other message untouched, by identity", () => {
    const next = toggleReactionPatch(messages, "m1", ME, "👀");
    expect(next[1]).toBe(messages[1]);
    expect(next[2]).toBe(messages[2]);
  });

  it("hands back the same array when the message is not in this thread", () => {
    // A stray patch must not re-render every open thread.
    expect(toggleReactionPatch(messages, "nope", ME, "👍")).toBe(messages);
  });

  it("survives an empty or missing thread", () => {
    expect(toggleReactionPatch([], "m1", ME, "👍")).toEqual([]);
    expect(toggleReactionPatch(null, "m1", ME, "👍")).toEqual([]);
    expect(toggleReactionPatch(undefined, "m1", ME, "👍")).toEqual([]);
  });

  it("does not mutate the message it patches", () => {
    const rows = [{ id: "m1", reactions: [r(YOU, "👍")] }];
    toggleReactionPatch(rows, "m1", ME, "👍");
    expect(rows[0].reactions).toEqual([r(YOU, "👍")]);
  });
});

describe("hasReaction", () => {
  it("is the decision toggleReactionPatch makes, exposed for the write", () => {
    const rows = [r(ME, "👍"), r(YOU, "🔥")];
    expect(hasReaction(rows, ME, "👍")).toBe(true);
    expect(hasReaction(rows, ME, "🔥")).toBe(false);
    expect(hasReaction(rows, YOU, "👍")).toBe(false);
    expect(hasReaction(null, ME, "👍")).toBe(false);
  });
});
