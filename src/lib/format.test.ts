import { describe, expect, it } from "vitest";
import {
  bedsBaths,
  FEE_TYPE_LABELS,
  INTERACTION_KIND_LABELS,
  listingLabel,
  money,
  moneyShort,
  rentShort,
  AC_LABELS,
  AC_MARKS,
  DISHWASHER_LABELS,
  DISHWASHER_MARKS,
  LAUNDRY_LABELS,
  LAUNDRY_MARKS,
  OUTDOOR_LABELS,
  OUTDOOR_MARKS,
  PETS_LABELS,
  PETS_MARKS,
  STATUS_LABELS,
  STATUS_TONE,
} from "./format";
import type {
  AcPolicy,
  DishwasherPolicy,
  FeeType,
  InteractionKind,
  LaundryPolicy,
  ListingStatus,
  OutdoorSpacePolicy,
  PetsPolicy,
} from "./types";

describe("money", () => {
  it("renders whole dollars with separators", () => {
    expect(money(3200)).toBe("$3,200");
    expect(money(1_234_567)).toBe("$1,234,567");
    expect(money(0)).toBe("$0");
  });

  it("stays quiet for a missing number so table cells do not shout", () => {
    expect(money(null)).toBe("");
    expect(money(undefined)).toBe("");
  });

  it("rounds cents away rather than showing them", () => {
    expect(money(3200.4)).toBe("$3,200");
    expect(money(3200.5)).toBe("$3,201");
  });
});

describe("moneyShort", () => {
  it("abbreviates thousands for the qualification column", () => {
    expect(moneyShort(310_000)).toBe("$310k");
    expect(moneyShort(1_000)).toBe("$1k");
    expect(moneyShort(1_234_567)).toBe("$1,235k");
  });

  it("shows small amounts in full, where 'k' would lose everything", () => {
    expect(moneyShort(999)).toBe("$999");
    expect(moneyShort(0)).toBe("$0");
  });

  it("switches format at exactly $1,000", () => {
    expect(moneyShort(999)).toBe("$999");
    expect(moneyShort(1000)).toBe("$1k");
  });

  it("is empty for a missing number", () => {
    expect(moneyShort(null)).toBe("");
    expect(moneyShort(undefined)).toBe("");
  });

  it("places the sign inconsistently for negatives, which never occur", () => {
    // Documented, not fixed: rents and incomes are non-negative, so nothing
    // renders this. Pinned so a future change is a deliberate one.
    expect(money(-5000)).toBe("-$5,000");
    expect(moneyShort(-5000)).toBe("$-5k");
    expect(moneyShort(-100)).toBe("-$100");
  });
});

describe("bedsBaths", () => {
  it("joins both halves", () => {
    expect(bedsBaths(2, 1)).toBe("2 bd / 1 ba");
    expect(bedsBaths(2, 1.5)).toBe("2 bd / 1.5 ba");
  });

  it("skips whichever half is missing", () => {
    expect(bedsBaths(2, null)).toBe("2 bd");
    expect(bedsBaths(null, 1)).toBe("1 ba");
    expect(bedsBaths(undefined, 1)).toBe("1 ba");
  });

  it("is empty when both are missing", () => {
    expect(bedsBaths(null, null)).toBe("");
    expect(bedsBaths(undefined, undefined)).toBe("");
  });

  it("keeps a zero, because a studio is not a missing bedroom count", () => {
    expect(bedsBaths(0, 1)).toBe("0 bd / 1 ba");
  });
});

/**
 * `listingLabel` is baked into every `activity.summary` at insert time, so its
 * output is permanent: a bad label is in the feed forever.
 */
describe("listingLabel", () => {
  it("renders the address as people say it", () => {
    expect(listingLabel("214 Grand St", "4B")).toBe("214 Grand St #4B");
  });

  it("drops the unit when there is not one", () => {
    expect(listingLabel("214 Grand St", null)).toBe("214 Grand St");
    expect(listingLabel("214 Grand St")).toBe("214 Grand St");
    expect(listingLabel("214 Grand St", "")).toBe("214 Grand St");
    expect(listingLabel("214 Grand St", "   ")).toBe("214 Grand St");
  });

  it("does not double the hash when the unit already has one", () => {
    expect(listingLabel("214 Grand St", "#4B")).toBe("214 Grand St #4B");
    expect(listingLabel("214 Grand St", " #4B ")).toBe("214 Grand St #4B");
  });

  it("only strips a leading hash, not one in the middle", () => {
    expect(listingLabel("214 Grand St", "4#B")).toBe("214 Grand St #4#B");
  });

  it("trims the address", () => {
    expect(listingLabel("  214 Grand St  ", "4B")).toBe("214 Grand St #4B");
  });

  it("never renders an empty label", () => {
    expect(listingLabel(null, null)).toBe("(no address)");
    expect(listingLabel("", null)).toBe("(no address)");
    expect(listingLabel("   ", null)).toBe("(no address)");
    expect(listingLabel(undefined, undefined)).toBe("(no address)");
  });

  it("still names the unit when the address is missing", () => {
    expect(listingLabel(null, "4B")).toBe("(no address) #4B");
  });
});

describe("label maps", () => {
  it("names every listing status", () => {
    const statuses: ListingStatus[] = [
      "saved",
      "contacted",
      "tour_scheduled",
      "toured",
      "applied",
      "passed",
      "lost",
    ];
    for (const status of statuses) {
      expect(STATUS_LABELS[status]).toBeTruthy();
    }
    expect(Object.keys(STATUS_LABELS)).toHaveLength(statuses.length);
    expect(STATUS_LABELS.tour_scheduled).toBe("Tour scheduled");
  });

  it("names every fee type", () => {
    const feeTypes: FeeType[] = ["no_fee", "fee", "op", "unknown"];
    for (const feeType of feeTypes) expect(FEE_TYPE_LABELS[feeType]).toBeTruthy();
    expect(Object.keys(FEE_TYPE_LABELS)).toHaveLength(feeTypes.length);
  });

  it("names every pet policy, long and short", () => {
    const policies: PetsPolicy[] = ["yes", "cats_only", "dogs_only", "no", "unknown"];
    for (const policy of policies) {
      expect(PETS_LABELS[policy]).toBeTruthy();
      expect(PETS_MARKS[policy]).toBeTruthy();
    }
    expect(Object.keys(PETS_LABELS)).toHaveLength(policies.length);
    expect(Object.keys(PETS_MARKS)).toHaveLength(policies.length);
  });

  it("keeps the marks short and the unknown one quiet", () => {
    expect(PETS_LABELS.yes).toBe("Pets OK");
    expect(PETS_LABELS.cats_only).toBe("Cats only");
    expect(PETS_MARKS.yes).toBe("🐾 OK");
    expect(PETS_MARKS.cats_only).toBe("🐱 Cats");
    expect(PETS_MARKS.dogs_only).toBe("🐶 Dogs");
    expect(PETS_MARKS.no).toBe("🚫 No");
    // An unanswered question reads as a blank cell, not as a fact.
    expect(PETS_MARKS.unknown).toBe("—");
  });

  it("names every amenity value, long and short", () => {
    const laundry: LaundryPolicy[] = ["in_unit", "in_building", "none", "unknown"];
    const dishwasher: DishwasherPolicy[] = ["yes", "no", "unknown"];
    const ac: AcPolicy[] = ["central", "window", "none", "unknown"];
    const outdoor: OutdoorSpacePolicy[] = ["private", "shared", "none", "unknown"];

    for (const v of laundry) {
      expect(LAUNDRY_LABELS[v]).toBeTruthy();
      expect(LAUNDRY_MARKS[v]).toBeTruthy();
    }
    for (const v of dishwasher) {
      expect(DISHWASHER_LABELS[v]).toBeTruthy();
      expect(DISHWASHER_MARKS[v]).toBeTruthy();
    }
    for (const v of ac) {
      expect(AC_LABELS[v]).toBeTruthy();
      expect(AC_MARKS[v]).toBeTruthy();
    }
    for (const v of outdoor) {
      expect(OUTDOOR_LABELS[v]).toBeTruthy();
      expect(OUTDOOR_MARKS[v]).toBeTruthy();
    }

    expect(Object.keys(LAUNDRY_LABELS)).toHaveLength(laundry.length);
    expect(Object.keys(LAUNDRY_MARKS)).toHaveLength(laundry.length);
    expect(Object.keys(DISHWASHER_LABELS)).toHaveLength(dishwasher.length);
    expect(Object.keys(DISHWASHER_MARKS)).toHaveLength(dishwasher.length);
    expect(Object.keys(AC_LABELS)).toHaveLength(ac.length);
    expect(Object.keys(AC_MARKS)).toHaveLength(ac.length);
    expect(Object.keys(OUTDOOR_LABELS)).toHaveLength(outdoor.length);
    expect(Object.keys(OUTDOOR_MARKS)).toHaveLength(outdoor.length);
  });

  it("keeps the amenity marks short and every unknown quiet", () => {
    expect(LAUNDRY_MARKS.in_unit).toBe("🧺 In-unit");
    expect(LAUNDRY_MARKS.in_building).toBe("🧺 Bldg");
    expect(LAUNDRY_MARKS.none).toBe("🚫 Laundry");
    expect(DISHWASHER_MARKS.yes).toBe("🍽️ DW");
    expect(DISHWASHER_MARKS.no).toBe("🚫 DW");
    expect(AC_MARKS.central).toBe("❄️ Central");
    expect(AC_MARKS.window).toBe("❄️ Window");
    expect(AC_MARKS.none).toBe("🚫 AC");
    expect(OUTDOOR_MARKS.private).toBe("🌿 Private");
    expect(OUTDOOR_MARKS.shared).toBe("🌿 Shared");
    expect(OUTDOOR_MARKS.none).toBe("🚫 Outdoor");

    // Same rule as pets: nobody asked reads as a blank cell, never as a fact.
    for (const mark of [
      LAUNDRY_MARKS.unknown,
      DISHWASHER_MARKS.unknown,
      AC_MARKS.unknown,
      OUTDOOR_MARKS.unknown,
    ]) {
      expect(mark).toBe("—");
    }
  });

  it("spells the amenity labels out where there is room for them", () => {
    expect(LAUNDRY_LABELS.in_unit).toBe("In-unit laundry");
    expect(LAUNDRY_LABELS.in_building).toBe("Laundry in building");
    expect(DISHWASHER_LABELS.no).toBe("No dishwasher");
    expect(AC_LABELS.central).toBe("Central AC");
    expect(OUTDOOR_LABELS.shared).toBe("Shared outdoor space");
  });

  it("names every interaction kind", () => {
    const kinds: InteractionKind[] = ["call", "email", "text", "tour", "note"];
    for (const kind of kinds) expect(INTERACTION_KIND_LABELS[kind]).toBeTruthy();
    expect(Object.keys(INTERACTION_KIND_LABELS)).toHaveLength(kinds.length);
  });
});

describe("rentShort", () => {
  it("keeps one decimal, so two rents do not round together", () => {
    expect(rentShort(5_200)).toBe("$5.2k");
    expect(rentShort(4_750)).toBe("$4.8k");
    expect(rentShort(5_249)).toBe("$5.2k");
  });

  it("drops a trailing zero — $5k is a rent, $5.0k is a spreadsheet", () => {
    expect(rentShort(5_000)).toBe("$5k");
    expect(rentShort(1_000)).toBe("$1k");
  });

  it("prints small amounts and blanks like moneyShort does", () => {
    expect(rentShort(999)).toBe("$999");
    expect(rentShort(0)).toBe("$0");
    expect(rentShort(null)).toBe("");
    expect(rentShort(undefined)).toBe("");
  });

  it("groups the thousands once a rent is silly money", () => {
    expect(rentShort(1_234_500)).toBe("$1,234.5k");
  });
});

describe("STATUS_TONE", () => {
  const statuses = Object.keys(STATUS_LABELS) as ListingStatus[];

  it("tints every status the picker offers — a missing one renders untinted", () => {
    for (const status of statuses) {
      expect(STATUS_TONE[status]).toBeTruthy();
    }
    expect(Object.keys(STATUS_TONE).sort()).toEqual([...statuses].sort());
  });

  it("strikes through the two that mean stop, and only those two", () => {
    for (const status of statuses) {
      expect(STATUS_TONE[status].includes("line-through")).toBe(
        status === "passed" || status === "lost",
      );
    }
  });

  it("borrows nothing from a person: no literal hex anywhere", () => {
    // Person colour is data (`people.color`); everything here is a token.
    for (const tone of Object.values(STATUS_TONE)) {
      expect(tone).not.toMatch(/#[0-9a-f]{3,8}/i);
    }
  });
});
