import { beforeEach, describe, expect, it } from "vitest";
import {
  hiddenKey,
  LISTINGS_VIEW_KEY,
  listingsView,
  setListingsView,
  hiddenLocationIds,
  primaryKey,
  primaryLocationId,
  setLocationHidden,
  setPrimaryLocation,
  toggleLocationHidden,
  visibleLocations,
} from "./prefs";

/**
 * These are per-device preferences, so the store is localStorage and the tests
 * install a fake `window`. The hooks themselves need React; what is worth
 * pinning here is that one person's toggles cannot reach another person's, and
 * that a corrupt value reads as "nothing hidden" rather than as a crash on the
 * listings page.
 */

const REESE = "aaaaaaaa-0000-0000-0000-000000000001";
const DYLAN = "bbbbbbbb-0000-0000-0000-000000000002";
const WORK = "cccccccc-0000-0000-0000-000000000003";
const GYM = "dddddddd-0000-0000-0000-000000000004";

function fakeWindow() {
  const store = new Map<string, string>();
  return {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    addEventListener: () => {},
    removeEventListener: () => {},
    __store: store,
  };
}

let win: ReturnType<typeof fakeWindow>;

beforeEach(() => {
  win = fakeWindow();
  (globalThis as { window?: unknown }).window = win;
});

describe("hidden locations", () => {
  it("starts empty", () => {
    expect([...hiddenLocationIds(REESE)]).toEqual([]);
  });

  it("toggles one off and back on", () => {
    expect([...toggleLocationHidden(REESE, WORK)]).toEqual([WORK]);
    expect([...hiddenLocationIds(REESE)]).toEqual([WORK]);
    expect([...toggleLocationHidden(REESE, WORK)]).toEqual([]);
    expect([...hiddenLocationIds(REESE)]).toEqual([]);
  });

  it("drops the key entirely once nothing is hidden", () => {
    toggleLocationHidden(REESE, WORK);
    toggleLocationHidden(REESE, WORK);
    expect(win.__store.has(hiddenKey(REESE))).toBe(false);
  });

  it("keeps one person's toggles off another person's screen", () => {
    toggleLocationHidden(REESE, WORK);
    expect([...hiddenLocationIds(REESE)]).toEqual([WORK]);
    expect([...hiddenLocationIds(DYLAN)]).toEqual([]);
  });

  it("holds more than one", () => {
    toggleLocationHidden(REESE, WORK);
    toggleLocationHidden(REESE, GYM);
    expect(hiddenLocationIds(REESE).has(WORK)).toBe(true);
    expect(hiddenLocationIds(REESE).has(GYM)).toBe(true);
  });

  it("sets a state directly without flipping it", () => {
    setLocationHidden(REESE, WORK, true);
    setLocationHidden(REESE, WORK, true);
    expect([...hiddenLocationIds(REESE)]).toEqual([WORK]);
    setLocationHidden(REESE, WORK, false);
    expect([...hiddenLocationIds(REESE)]).toEqual([]);
  });

  it("reads garbage as 'nothing hidden'", () => {
    win.__store.set(hiddenKey(REESE), "{not json");
    expect([...hiddenLocationIds(REESE)]).toEqual([]);
    win.__store.set(hiddenKey(REESE), '{"work":true}');
    expect([...hiddenLocationIds(REESE)]).toEqual([]);
    win.__store.set(hiddenKey(REESE), '["ok", 42, null]');
    expect([...hiddenLocationIds(REESE)]).toEqual(["ok"]);
  });

  it("hands back the same object while the stored text is unchanged", () => {
    // `useSyncExternalStore` compares snapshots by identity: a fresh Set on
    // every read is an infinite render loop.
    toggleLocationHidden(REESE, WORK);
    expect(hiddenLocationIds(REESE)).toBe(hiddenLocationIds(REESE));
  });
});

describe("the starred location", () => {
  it("is null until somebody picks one", () => {
    expect(primaryLocationId(REESE)).toBeNull();
  });

  it("stores one id per person", () => {
    setPrimaryLocation(REESE, WORK);
    setPrimaryLocation(DYLAN, GYM);
    expect(primaryLocationId(REESE)).toBe(WORK);
    expect(primaryLocationId(DYLAN)).toBe(GYM);
  });

  it("clears when the starred one is starred again", () => {
    setPrimaryLocation(REESE, WORK);
    setPrimaryLocation(REESE, WORK);
    expect(primaryLocationId(REESE)).toBeNull();
    expect(win.__store.has(primaryKey(REESE))).toBe(false);
  });

  it("moves the star to another place", () => {
    setPrimaryLocation(REESE, WORK);
    setPrimaryLocation(REESE, GYM);
    expect(primaryLocationId(REESE)).toBe(GYM);
  });

  it("clears on null", () => {
    setPrimaryLocation(REESE, WORK);
    setPrimaryLocation(REESE, null);
    expect(primaryLocationId(REESE)).toBeNull();
  });
});

describe("visibleLocations", () => {
  const locations = [{ id: WORK }, { id: GYM }];

  it("drops the hidden ones", () => {
    expect(visibleLocations(locations, new Set([GYM]))).toEqual([{ id: WORK }]);
  });

  it("passes everything through when nothing is hidden", () => {
    expect(visibleLocations(locations, new Set())).toEqual(locations);
  });

  it("is empty for an absent list", () => {
    expect(visibleLocations(undefined, new Set())).toEqual([]);
  });
});

describe("no window", () => {
  it("reads as empty on the server rather than throwing", () => {
    delete (globalThis as { window?: unknown }).window;
    expect([...hiddenLocationIds(REESE)]).toEqual([]);
    expect(primaryLocationId(REESE)).toBeNull();
    // And a write is a no-op, not a crash.
    expect(() => setPrimaryLocation(REESE, WORK)).not.toThrow();
  });
});

describe("listings view", () => {
  it("is the list until somebody says otherwise", () => {
    expect(listingsView()).toBe("list");
  });

  it("remembers the map", () => {
    setListingsView("map");
    expect(listingsView()).toBe("map");
    expect(win.__store.get(LISTINGS_VIEW_KEY)).toBe("map");
  });

  it("stores nothing for the default, and ignores junk", () => {
    setListingsView("map");
    setListingsView("list");
    expect(win.__store.has(LISTINGS_VIEW_KEY)).toBe(false);
    win.__store.set(LISTINGS_VIEW_KEY, "globe");
    expect(listingsView()).toBe("list");
  });
});
