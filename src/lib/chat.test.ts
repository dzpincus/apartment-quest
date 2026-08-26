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

  it("groups a single message on its own", () => {
    const groups = groupMessages([msg("a", "dylan")]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: "a", personId: "dylan" });
    expect(groups[0].items).toHaveLength(1);
  });

  it("keys a group by its first message and stamps it with that message's time", () => {
    const groups = groupMessages([
      msg("a", "dylan", 0),
      msg("b", "dylan", 60_000),
      msg("c", "reese", 120_000),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["a", "c"]);
    expect(groups[0].startedAt).toBe(new Date(T0).toISOString());
    expect(groups[1].startedAt).toBe(new Date(T0 + 120_000).toISOString());
  });

  it("hands back the original row objects and every message exactly once", () => {
    const rows = [
      msg("a", "dylan", 0),
      msg("b", "reese", 60_000),
      msg("c", "reese", 120_000),
      msg("d", "dylan", 999 * 60_000),
    ];
    const groups = groupMessages(rows);
    const flattened = groups.flatMap((g) => g.items);
    expect(flattened).toHaveLength(rows.length);
    expect(flattened.map((m) => m.id)).toEqual(["a", "b", "c", "d"]);
    expect(flattened[0]).toBe(rows[0]);
  });

  it("does not mutate the array it was given", () => {
    const rows = [msg("a", "dylan", 0), msg("b", "dylan", 60_000)];
    groupMessages(rows);
    expect(rows.map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("breaks one millisecond past the threshold", () => {
    expect(
      groupMessages([msg("a", "dylan", 0), msg("b", "dylan", GROUP_GAP_MS + 1)]),
    ).toHaveLength(2);
  });

  it("keeps two messages posted in the same millisecond together", () => {
    expect(groupMessages([msg("a", "dylan", 0), msg("b", "dylan", 0)])).toHaveLength(1);
  });

  it("still splits on the person even when the timestamps are identical", () => {
    const groups = groupMessages([msg("a", "dylan", 0), msg("b", "reese", 0)]);
    expect(groups.map((g) => g.personId)).toEqual(["dylan", "reese"]);
  });

  it("never breaks a run when every timestamp is missing", () => {
    const rows = [
      { id: "a", person_id: "dylan", created_at: null },
      { id: "b", person_id: "dylan", created_at: null },
      { id: "c", person_id: "dylan", created_at: null },
    ];
    expect(groupMessages(rows)).toHaveLength(1);
    expect(groupMessages(rows)[0].startedAt).toBeNull();
  });

  it("treats an unparseable timestamp like a missing one", () => {
    const rows = [
      { id: "a", person_id: "dylan", created_at: "not-a-date" },
      { id: "b", person_id: "dylan", created_at: "also-not-a-date" },
    ];
    expect(groupMessages(rows)).toHaveLength(1);
  });

  it("measures the gap from the last message that HAD a timestamp", () => {
    // A null in the middle must not silently reset the clock and let a much
    // later message join the run.
    const rows: GroupableMessage[] = [
      msg("a", "dylan", 0),
      { id: "b", person_id: "dylan", created_at: null },
      msg("c", "dylan", GROUP_GAP_MS + 60_000),
    ];
    const groups = groupMessages(rows);
    expect(groups).toHaveLength(2);
    expect(groups[0].items.map((m) => m.id)).toEqual(["a", "b"]);
    expect(groups[1].items.map((m) => m.id)).toEqual(["c"]);
  });

  it("puts every message in its own group when a gap of zero is asked for", () => {
    const rows = [msg("a", "dylan", 0), msg("b", "dylan", 1), msg("c", "dylan", 2)];
    expect(groupMessages(rows, 0)).toHaveLength(3);
  });

  it("collapses a whole thread into one group for an infinite gap", () => {
    const rows = [msg("a", "dylan", 0), msg("b", "dylan", 99 * 86_400_000)];
    expect(groupMessages(rows, Number.POSITIVE_INFINITY)).toHaveLength(1);
  });

  it("alternating authors never merge, however fast they type", () => {
    const rows = [
      msg("a", "dylan", 0),
      msg("b", "reese", 1),
      msg("c", "dylan", 2),
      msg("d", "reese", 3),
    ];
    expect(groupMessages(rows)).toHaveLength(4);
  });
});
