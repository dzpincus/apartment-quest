import { describe, expect, it } from "vitest";
import {
  blockedNote,
  emptySync,
  errorNote,
  isBlockedNote,
  isManuallyConfirmedNote,
  isUnconfirmedNote,
  learnedNothing,
  MANUAL_GONE_NOTE,
  MANUAL_LIVE_NOTE,
  NOTE_CAP,
  type SyncOutcome,
} from "./sync-types";

/**
 * `learnedNothing` is the whole safety property of the sync: it is the only
 * thing standing between a bad night on a listing site and every vanished
 * listing quietly resetting itself to `unknown`.
 */

describe("learnedNothing", () => {
  it("is false for a real state over anything", () => {
    const outcome: SyncOutcome = { kind: "state", state: "off_market", note: "rented" };
    expect(learnedNothing(outcome, "active")).toBe(false);
    expect(learnedNothing(outcome, "unknown")).toBe(false);
    expect(learnedNothing({ kind: "state", state: "active", note: "" }, "removed")).toBe(false);
  });

  it("is true when an unclassifiable page would overwrite something known", () => {
    const outcome: SyncOutcome = { kind: "state", state: "unknown", note: "no signal" };
    expect(learnedNothing(outcome, "off_market")).toBe(true);
    expect(learnedNothing(outcome, "removed")).toBe(true);
    expect(learnedNothing(outcome, "active")).toBe(true);
  });

  it("is false for the first sighting of a listing we knew nothing about", () => {
    expect(learnedNothing({ kind: "state", state: "unknown", note: "" }, "unknown")).toBe(false);
  });

  it("is true for a block, an error and a deadline skip, whatever we knew", () => {
    for (const before of ["unknown", "active", "off_market", "removed"] as const) {
      expect(learnedNothing({ kind: "blocked", note: "blocked — captcha" }, before)).toBe(true);
      expect(learnedNothing({ kind: "error", message: "boom" }, before)).toBe(true);
      expect(learnedNothing({ kind: "skipped" }, before)).toBe(true);
    }
  });
});

describe("emptySync", () => {
  it("hands out a fresh object and fresh arrays each time", () => {
    const a = emptySync();
    const b = emptySync();
    expect(a).not.toBe(b);
    expect(a.changed).not.toBe(b.changed);
    a.changed.push({ id: "x", label: "y", from: "unknown", to: "active" });
    expect(b.changed).toHaveLength(0);
  });

  it("counts nothing", () => {
    expect(emptySync()).toEqual({
      ran: false,
      skipped_hour_gate: false,
      checked: 0,
      changed: [],
      blocked: 0,
      errors: 0,
      skipped_deadline: 0,
    });
  });
});

describe("errorNote", () => {
  it("says error, not blocked — the two mean different things to the ladder", () => {
    expect(errorNote("ECONNRESET")).toBe("error — ECONNRESET");
    expect(isBlockedNote(errorNote("ECONNRESET"))).toBe(false);
    expect(isBlockedNote(blockedNote("captcha"))).toBe(true);
  });

  it("fits in the column", () => {
    expect(errorNote("x".repeat(500))).toHaveLength(NOTE_CAP);
  });
});

describe("the notes a person writes", () => {
  it("recognises the one 'Still live' leaves behind", () => {
    expect(isManuallyConfirmedNote(MANUAL_LIVE_NOTE)).toBe(true);
    expect(isManuallyConfirmedNote("Manually confirmed on the phone")).toBe(true);
  });

  it("does not confuse 'Report gone' with it — they are opposite claims", () => {
    expect(isManuallyConfirmedNote(MANUAL_GONE_NOTE)).toBe(false);
  });

  it("is not fooled by a robot's note, or by nothing at all", () => {
    expect(isManuallyConfirmedNote("streeteasy.com: status ACTIVE")).toBe(false);
    expect(isManuallyConfirmedNote(blockedNote("captcha"))).toBe(false);
    expect(isManuallyConfirmedNote(null)).toBe(false);
    expect(isManuallyConfirmedNote(undefined)).toBe(false);
  });
});

describe("isUnconfirmedNote", () => {
  it("recognises a gone nothing could stand behind", () => {
    expect(isUnconfirmedNote("unconfirmed: streeteasy.com: no longer available")).toBe(true);
  });

  it("is not a blocked note and not an error note", () => {
    expect(isUnconfirmedNote(blockedNote("403"))).toBe(false);
    expect(isUnconfirmedNote(errorNote("ECONNRESET"))).toBe(false);
    expect(isBlockedNote("unconfirmed: x")).toBe(false);
  });
});
