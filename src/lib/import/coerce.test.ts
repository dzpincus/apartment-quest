import { describe, expect, it } from "vitest";
import {
  coerceExtract,
  normalizeTrains,
  parseAmount,
  parseDate,
  splitUnit,
  type RawExtract,
} from "./coerce";

/** A plausible, well-behaved extraction — the baseline every test edits. */
const GOOD: RawExtract = {
  address: "92 Bowery",
  unit: "7C",
  neighborhood: "Chinatown",
  rent: 4395,
  beds: 1,
  baths: 1,
  sqft: 620,
  available_date: "2025-10-15",
  fee_type: "no_fee",
  broker_fee_pct: null,
  guarantor_ok: "yes",
  pets: "yes",
  pet_notes: "Under 40 lb, $350 deposit",
  laundry: "in_unit",
  dishwasher: "yes",
  ac: "central",
  outdoor_space: "shared",
  trains: ["B", "D", "J", "N", "Q", "R", "Z", "6"],
  broker: {
    name: "Priya Raman",
    company: "Bowery Residential",
    phone: "(212) 555-0188",
    email: "priya@boweryres.com",
  },
  notes: "In-unit washer/dryer, dishwasher, elevator, roof deck.",
  confidence: 0.92,
  source_title: "92 Bowery #7C",
};

describe("coerceExtract — the happy path", () => {
  it("turns every value into the string the form holds", () => {
    const { fields } = coerceExtract(GOOD, { url: "https://streeteasy.com/building/92-bowery/7c" });
    expect(fields).toMatchObject({
      address: "92 Bowery",
      unit: "7C",
      neighborhood: "Chinatown",
      rent: "4395",
      beds: "1",
      baths: "1",
      sqft: "620",
      available_date: "2025-10-15",
      fee_type: "no_fee",
      guarantor_ok: "yes",
      pets: "yes",
      laundry: "in_unit",
      dishwasher: "yes",
      ac: "central",
      outdoor_space: "shared",
      trains: "B D J N Q R Z 6",
      url: "https://streeteasy.com/building/92-bowery/7c",
    });
    expect(Object.values(fields).every((v) => typeof v === "string")).toBe(true);
  });

  it("reports the broker separately from the form fields", () => {
    const { broker, fields } = coerceExtract(GOOD);
    expect(broker).toEqual({
      name: "Priya Raman",
      company: "Bowery Residential",
      phone: "(212) 555-0188",
      email: "priya@boweryres.com",
    });
    expect("broker_id" in fields).toBe(false);
  });

  it("counts only fields that carry information", () => {
    const { filledKeys, warnings } = coerceExtract(GOOD);
    expect(filledKeys).toContain("rent");
    expect(filledKeys).toContain("fee_type");
    expect(filledKeys).not.toContain("income_multiplier");
    expect(warnings).toEqual([]);
  });
});

describe("coerceExtract — money", () => {
  it('reads "$4,200/mo" as 4200', () => {
    expect(coerceExtract({ ...GOOD, rent: "$4,200/mo" }).fields.rent).toBe("4200");
  });

  it("rejects a yearly figure instead of storing it as monthly rent", () => {
    const { fields, warnings } = coerceExtract({ ...GOOD, rent: 52_800 });
    expect(fields.rent).toBeUndefined();
    expect(warnings.join(" ")).toMatch(/not a monthly figure/i);
  });

  it("rejects a price-per-square-foot style number too", () => {
    expect(coerceExtract({ ...GOOD, rent: 42 }).fields.rent).toBeUndefined();
  });

  it("leaves rent alone, with no warning, when the page never said one", () => {
    const { fields, warnings } = coerceExtract({ ...GOOD, rent: null });
    expect(fields.rent).toBeUndefined();
    expect(warnings).toEqual([]);
  });
});

describe("coerceExtract — enums", () => {
  it("accepts the enum values the form uses", () => {
    expect(coerceExtract({ ...GOOD, fee_type: "op" }).fields.fee_type).toBe("op");
    expect(coerceExtract({ ...GOOD, pets: "cats_only" }).fields.pets).toBe("cats_only");
  });

  it("normalises near misses rather than dropping them", () => {
    expect(coerceExtract({ ...GOOD, fee_type: "No Fee" }).fields.fee_type).toBe("no_fee");
    expect(coerceExtract({ ...GOOD, fee_type: "owner paid" }).fields.fee_type).toBe("op");
    expect(coerceExtract({ ...GOOD, pets: "cats" }).fields.pets).toBe("cats_only");
    expect(coerceExtract({ ...GOOD, guarantor_ok: "true" }).fields.guarantor_ok).toBe("yes");
  });

  it("omits an unknown or unrecognised enum so it cannot overwrite a blank", () => {
    for (const value of ["unknown", "maybe?", "", null]) {
      const { fields } = coerceExtract({ ...GOOD, fee_type: value, pets: value });
      expect(fields.fee_type).toBeUndefined();
      expect(fields.pets).toBeUndefined();
    }
  });
});

describe("coerceExtract — amenity enums (0009)", () => {
  it("accepts every value the four columns allow", () => {
    const at = (over: Partial<RawExtract>) => coerceExtract({ ...GOOD, ...over }).fields;
    expect(at({ laundry: "in_building" }).laundry).toBe("in_building");
    expect(at({ dishwasher: "no" }).dishwasher).toBe("no");
    expect(at({ ac: "window" }).ac).toBe("window");
    expect(at({ outdoor_space: "private" }).outdoor_space).toBe("private");
  });

  it("keeps `none`, which is an answer and not an absence", () => {
    // "This building has no laundry" is worth storing, and `str()` reads the
    // bare word "none" as a blank everywhere else — the enums are the
    // exception.
    const { fields } = coerceExtract({
      ...GOOD,
      laundry: "none",
      ac: "none",
      outdoor_space: "none",
    });
    expect(fields.laundry).toBe("none");
    expect(fields.ac).toBe("none");
    expect(fields.outdoor_space).toBe("none");
  });

  it("normalises the near misses a model actually emits", () => {
    const at = (over: Partial<RawExtract>) => coerceExtract({ ...GOOD, ...over }).fields;
    expect(at({ laundry: "In Unit" }).laundry).toBe("in_unit");
    expect(at({ laundry: "washer dryer" }).laundry).toBe("in_unit");
    expect(at({ laundry: "laundry room" }).laundry).toBe("in_building");
    expect(at({ ac: "central air" }).ac).toBe("central");
    expect(at({ ac: "window unit" }).ac).toBe("window");
    expect(at({ outdoor_space: "balcony" }).outdoor_space).toBe("private");
    expect(at({ outdoor_space: "roof deck" }).outdoor_space).toBe("shared");
    expect(at({ dishwasher: "true" }).dishwasher).toBe("yes");
  });

  it("omits anything unknown or unrecognised so it cannot overwrite a blank", () => {
    for (const value of ["unknown", "maybe?", "", null, "sometimes"]) {
      const { fields } = coerceExtract({
        ...GOOD,
        laundry: value,
        dishwasher: value,
        ac: value,
        outdoor_space: value,
      });
      expect(fields.laundry).toBeUndefined();
      expect(fields.dishwasher).toBeUndefined();
      expect(fields.ac).toBeUndefined();
      expect(fields.outdoor_space).toBeUndefined();
    }
  });

  it("never lets one column's vocabulary leak into another's", () => {
    // `in_unit` is not a dishwasher answer and `central` is not a laundry one;
    // an enum that is nearly right for a different column is still wrong.
    const { fields } = coerceExtract({
      ...GOOD,
      dishwasher: "in_unit",
      laundry: "central",
      ac: "private",
      outdoor_space: "in_building",
    });
    expect(fields.dishwasher).toBeUndefined();
    expect(fields.laundry).toBeUndefined();
    expect(fields.ac).toBeUndefined();
    expect(fields.outdoor_space).toBeUndefined();
  });

  it("counts a real amenity as a filled field", () => {
    const { filledKeys } = coerceExtract(GOOD);
    expect(filledKeys).toContain("laundry");
    expect(filledKeys).toContain("ac");
  });
});

describe("coerceExtract — absences", () => {
  it('treats "N/A" and friends as nothing at all', () => {
    const { fields } = coerceExtract({
      ...GOOD,
      neighborhood: "N/A",
      pet_notes: "none",
      notes: "—",
      sqft: "not listed",
    });
    expect(fields.neighborhood).toBeUndefined();
    expect(fields.pet_notes).toBeUndefined();
    expect(fields.notes).toBeUndefined();
    expect(fields.sqft).toBeUndefined();
  });

  it("warns when there is no address, because the form requires one", () => {
    const { fields, warnings } = coerceExtract({ ...GOOD, address: null });
    expect(fields.address).toBeUndefined();
    expect(warnings.join(" ")).toMatch(/address/i);
  });

  it("warns when the model says this is not a single listing", () => {
    const { warnings } = coerceExtract({ ...GOOD, confidence: 0.2 });
    expect(warnings.join(" ")).toMatch(/single listing/i);
  });

  it("clamps confidence and defaults it when missing", () => {
    expect(coerceExtract({ ...GOOD, confidence: 7 }).confidence).toBe(1);
    expect(coerceExtract({ ...GOOD, confidence: -2 }).confidence).toBe(0);
    expect(coerceExtract({ ...GOOD, confidence: null }).confidence).toBe(0.5);
  });

  it("returns no broker when the page named nobody", () => {
    expect(coerceExtract({ ...GOOD, broker: null }).broker).toBeNull();
    expect(coerceExtract({ ...GOOD, broker: { company: "Anon LLC" } }).broker).toBeNull();
  });

  it("truncates notes rather than letting a novel into the column", () => {
    const { fields } = coerceExtract({ ...GOOD, notes: "x".repeat(900) });
    expect(fields.notes).toHaveLength(300);
  });
});

describe("splitUnit", () => {
  it("pulls a trailing unit off an address the model did not split", () => {
    expect(splitUnit("214 Grand St #4B", "")).toEqual({ address: "214 Grand St", unit: "4B" });
    expect(splitUnit("214 Grand St Apt. 4B", "")).toEqual({
      address: "214 Grand St",
      unit: "4B",
    });
    expect(splitUnit("214 Grand St, Unit 4-B", "")).toEqual({
      address: "214 Grand St",
      unit: "4-B",
    });
  });

  it("leaves a unit the model already gave us alone", () => {
    expect(splitUnit("214 Grand St #4B", "7C")).toEqual({
      address: "214 Grand St #4B",
      unit: "7C",
    });
  });

  it("does not invent a unit out of a street number", () => {
    expect(splitUnit("214 Grand St", "")).toEqual({ address: "214 Grand St", unit: "" });
  });

  it("runs inside coerceExtract", () => {
    const { fields } = coerceExtract({ ...GOOD, address: "214 Grand St #4B", unit: null });
    expect(fields.address).toBe("214 Grand St");
    expect(fields.unit).toBe("4B");
  });
});

describe("parseDate", () => {
  it("keeps a yyyy-MM-dd and trims a full timestamp down to one", () => {
    expect(parseDate("2025-10-15")).toBe("2025-10-15");
    expect(parseDate("2025-10-15T00:00:00.000Z")).toBe("2025-10-15");
  });

  it("reads the loose formats a model sometimes emits", () => {
    expect(parseDate("September 1, 2025")).toBe("2025-09-01");
  });

  it("refuses words, absences and nonsense", () => {
    expect(parseDate("immediately")).toBeNull();
    expect(parseDate("N/A")).toBeNull();
    expect(parseDate("2025-13-45")).toBeNull();
    expect(parseDate(null)).toBeNull();
  });
});

describe("parseAmount", () => {
  it("digs a number out of the usual decorations", () => {
    expect(parseAmount("$4,200/mo")).toBe(4200);
    expect(parseAmount("1.5 baths")).toBe(1.5);
    expect(parseAmount(3200)).toBe(3200);
  });

  it("reads a studio as zero bedrooms", () => {
    expect(parseAmount("Studio")).toBe(0);
    expect(coerceExtract({ ...GOOD, beds: "Studio" }).fields.beds).toBe("0");
  });

  it("returns null when there is no number", () => {
    expect(parseAmount("call for price")).toBeNull();
    expect(parseAmount(null)).toBeNull();
  });
});

describe("normalizeTrains", () => {
  it("accepts an array or a comma list and prints them the way the form does", () => {
    expect(normalizeTrains(["J", "M", "Z"])).toBe("J M Z");
    expect(normalizeTrains("J, M, Z")).toBe("J M Z");
    expect(normalizeTrains("J/M/Z trains")).toBe("J M Z");
  });

  it("drops words, de-duplicates and caps the list", () => {
    expect(normalizeTrains("the L and the G")).toBe("L G");
    expect(normalizeTrains("A A C E")).toBe("A C E");
    expect(normalizeTrains("A B C D E F G J L M")).toBe("A B C D E F G J");
  });

  it("is empty when the page named no trains", () => {
    expect(normalizeTrains(null)).toBe("");
    expect(normalizeTrains("subway nearby")).toBe("");
  });
});

/**
 * Nothing the model says is trusted, and that has to include *length*. A page
 * built to be scraped can hand back a breadcrumb trail as an address or four
 * kilobytes of anything as a broker name, and every one of these lands in a
 * single-line input on the add form.
 */
describe("coerceExtract — length caps", () => {
  it("caps the address at 120 characters", () => {
    const { fields } = coerceExtract({ ...GOOD, address: "A".repeat(400), unit: "7C" });
    expect(fields.address).toHaveLength(120);
  });

  it("caps the neighborhood at 120 characters", () => {
    const { fields } = coerceExtract({ ...GOOD, neighborhood: "N".repeat(400) });
    expect(fields.neighborhood).toHaveLength(120);
  });

  it("caps the broker's name, company and phone", () => {
    const { broker } = coerceExtract({
      ...GOOD,
      broker: {
        name: "N".repeat(400),
        company: "C".repeat(400),
        phone: "5".repeat(400),
        email: "a@b.com",
      },
    });
    expect(broker?.name).toHaveLength(120);
    expect(broker?.company).toHaveLength(120);
    expect(broker?.phone).toHaveLength(40);
  });

  it("leaves an ordinary value alone", () => {
    const { fields, broker } = coerceExtract(GOOD);
    expect(fields.address).toBe("92 Bowery");
    expect(broker?.name).toBe("Priya Raman");
    expect(broker?.phone).toBe("(212) 555-0188");
  });

  it("drops an email that is not one, rather than truncating it", () => {
    for (const email of [
      "email us at the office",
      "priya at boweryres dot com",
      "priya@boweryres",
      `${"a".repeat(200)}@boweryres.com`,
    ]) {
      const { broker } = coerceExtract({ ...GOOD, broker: { ...GOOD.broker, email } });
      expect(broker?.email).toBe("");
    }
  });

  it("keeps a real one", () => {
    const { broker } = coerceExtract(GOOD);
    expect(broker?.email).toBe("priya@boweryres.com");
  });
});

describe("coerceExtract — the stored URL", () => {
  it("normalises it, so the next import's duplicate check can match", () => {
    const { fields } = coerceExtract(GOOD, {
      url: "https://StreetEasy.com/building/92-bowery/7c/?utm_source=share#photos",
    });
    expect(fields.url).toBe("https://streeteasy.com/building/92-bowery/7c");
  });
});
