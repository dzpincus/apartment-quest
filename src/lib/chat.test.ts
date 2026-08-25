import { describe, expect, it } from "vitest";
import { GROUP_GAP_MS, groupMessages, type GroupableMessage } from "./chat";

const T0 = Date.parse("2025-08-27T18:00:00Z");

function msg(
  id: string,
  personId: string,
  offsetMs = 0,
): GroupableMessage & { body: string } {
  return {
    id,
    person_id: personId,
    created_at: new Date(T0 + offsetMs).toISOString(),
    body: id,
  };
}

describe("groupMessages", () => {
  it("returns nothing for an empty thread", () => {
    expect(groupMessages([])).toEqual([]);
  });

  it("folds consecutive messages from one person into a run", () => {
    const groups = groupMessages([
      msg("a", "dylan", 0),
      msg("b", "dylan", 1_000),
      msg("c", "dylan", 2_000),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("a");
    expect(groups[0].personId).toBe("dylan");
    expect(groups[0].items.map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("starts a new run when the person changes, and again when they come back", () => {
    const groups = groupMessages([
      msg("a", "dylan"),
      msg("b", "reese", 1_000),
      msg("c", "dylan", 2_000),
    ]);
    expect(groups.map((g) => g.personId)).toEqual(["dylan", "reese", "dylan"]);
  });

  it("breaks a run after a long silence from the same person", () => {
    const groups = groupMessages([
      msg("a", "dylan", 0),
      msg("b", "dylan", GROUP_GAP_MS + 1),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["a", "b"]);
  });

  it("keeps a run when the gap is exactly the threshold", () => {
    const groups = groupMessages([
      msg("a", "dylan", 0),
      msg("b", "dylan", GROUP_GAP_MS),
    ]);
    expect(groups).toHaveLength(1);
  });

  it("honours a custom gap", () => {
    const rows = [msg("a", "dylan", 0), msg("b", "dylan", 60_000)];
    expect(groupMessages(rows, 30_000)).toHaveLength(2);
    expect(groupMessages(rows, 90_000)).toHaveLength(1);
  });

  it("never breaks a run on a missing timestamp", () => {
    const groups = groupMessages([
      { id: "a", person_id: "dylan", created_at: null },
      { id: "b", person_id: "dylan", created_at: null },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].startedAt).toBeNull();
  });

  it("measures the gap from the previous message, not the start of the run", () => {
    // Three messages six minutes apart: one run, even though a to c is 12min.
    const groups = groupMessages([
      msg("a", "dylan", 0),
      msg("b", "dylan", 6 * 60_000),
      msg("c", "dylan", 12 * 60_000),
    ]);
    expect(groups).toHaveLength(1);
  });
});
