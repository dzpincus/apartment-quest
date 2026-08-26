import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildPrompt,
  decodeEntities,
  extractJsonLd,
  extractMeta,
  extractNextData,
  jsonFacts,
  looksBlocked,
  reduceHtml,
  visibleText,
} from "./reduce";

const fixture = (name: string) =>
  readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");

const ZILLOW = fixture("zillow-like.html");
const STREETEASY = fixture("streeteasy-like.html");
const CAPTCHA = fixture("captcha.html");
const SHELL = fixture("js-shell.html");

type Node = Record<string, unknown>;

describe("extractJsonLd", () => {
  it("keeps listing-ish nodes and drops the page furniture", () => {
    const nodes = extractJsonLd(STREETEASY) as Node[];
    const types = nodes.map((n) => n["@type"]);
    expect(types).toContain("Apartment");
    expect(types).toContain("Organization");
    // A breadcrumb trail is not a listing and only costs tokens.
    expect(types).not.toContain("BreadcrumbList");
  });

  it("survives a script block that is not valid JSON", () => {
    // The fixture has one deliberately broken `ld+json` block.
    expect(() => extractJsonLd(STREETEASY)).not.toThrow();
    expect(extractJsonLd(STREETEASY).length).toBe(2);
  });

  it("returns nothing rather than throwing on a page with no JSON-LD", () => {
    expect(extractJsonLd(ZILLOW)).toEqual([]);
  });
});

describe("extractMeta", () => {
  it("pulls og:*, twitter:* and description, and nothing else", () => {
    const meta = extractMeta(ZILLOW);
    expect(meta["og:title"]).toBe("214 Grand St APT 4B, Brooklyn, NY 11211");
    expect(meta["og:description"]).toContain("$4,200/mo");
    expect(meta["twitter:card"]).toBe("summary_large_image");
    expect(meta["description"]).toContain("apartment for rent");
    expect(Object.keys(meta).every((k) => /^(og:|twitter:|description|keywords)/.test(k))).toBe(
      true,
    );
  });

  it("decodes entities in content", () => {
    expect(extractMeta('<meta name="description" content="1 bed &amp; 1 bath">')).toEqual({
      description: "1 bed & 1 bath",
    });
  });
});

describe("extractNextData + jsonFacts", () => {
  it("finds __NEXT_DATA__ and flattens only the apartment-ish leaves", () => {
    const data = extractNextData(ZILLOW);
    expect(data).toBeTruthy();
    const facts = jsonFacts(data);

    expect(facts.some((f) => /streetAddress: 214 Grand St APT 4B$/.test(f))).toBe(true);
    expect(facts.some((f) => /\bprice: 4200$/.test(f))).toBe(true);
    expect(facts.some((f) => /bedrooms: 2$/.test(f))).toBe(true);
    expect(facts.some((f) => /bathrooms: 1$/.test(f))).toBe(true);
    expect(facts.some((f) => /petsAllowed: Cats$/.test(f))).toBe(true);
    expect(facts.some((f) => /feeType: No fee$/.test(f))).toBe(true);
    expect(facts.some((f) => /agentName: Dana Reyes$/.test(f))).toBe(true);

    // Build ids, page names and routing state are not worth a token.
    expect(facts.some((f) => f.startsWith("buildId"))).toBe(false);
  });

  it("keeps the path so a value can be traced back", () => {
    const facts = jsonFacts({ a: { b: { rentPrice: 3200 } } });
    expect(facts).toEqual(["a.b.rentPrice: 3200"]);
  });

  it("obeys the fact and depth limits", () => {
    const wide = Object.fromEntries(
      Array.from({ length: 400 }, (_, i) => [`price${i}`, i + 1]),
    );
    expect(jsonFacts(wide, { maxFacts: 10 })).toHaveLength(10);

    const deep = { price: 1, nest: { price: 2, nest: { price: 3 } } };
    expect(jsonFacts(deep, { maxDepth: 1 })).toEqual(["price: 1", "nest.price: 2"]);
  });

  it("ignores empty, false and null leaves", () => {
    expect(jsonFacts({ price: "", fee: false, beds: null, rent: 0 })).toEqual(["rent: 0"]);
  });

  it("returns nothing when there is no data blob", () => {
    expect(extractNextData("<html><body>hi</body></html>")).toBeUndefined();
    expect(jsonFacts(undefined)).toEqual([]);
  });
});

describe("visibleText", () => {
  it("drops scripts, styles, nav and footer, and collapses whitespace", () => {
    const text = visibleText(ZILLOW);
    expect(text).toContain("214 Grand St APT 4B");
    expect(text).toContain("No broker fee");
    expect(text).not.toContain("window.dataLayer");
    expect(text).not.toContain("__NEXT_DATA__");
    expect(text).not.toContain("color: #000");
    expect(text).not.toContain("Do Not Sell My Personal Information");
    expect(text).not.toContain("Manage Rentals");
    expect(text).not.toMatch(/ {2}/);
  });

  it("decodes entities in body copy", () => {
    expect(visibleText("<p>620 ft&sup2; &amp; a roof deck</p>")).toBe("620 ft² & a roof deck");
  });
});

describe("decodeEntities", () => {
  it("handles named, decimal and hex references and leaves the rest alone", () => {
    expect(decodeEntities("a &amp; b &#39;c&#39; &#x27;d&#x27; &nbsp;e &notathing;")).toBe(
      "a & b 'c' 'd'  e &notathing;",
    );
  });
});

describe("buildPrompt", () => {
  it("puts structured data first and text last", () => {
    const prompt = buildPrompt(reduceHtml(STREETEASY));
    expect(prompt.indexOf("=== META ===")).toBe(0);
    expect(prompt.indexOf("=== JSON-LD ===")).toBeLessThan(prompt.indexOf("=== PAGE TEXT ==="));
    expect(prompt).toContain("92 Bowery");
    expect(prompt).toContain("$4,395");
  });

  it("includes the __NEXT_DATA__ facts section when there is one", () => {
    const prompt = buildPrompt(reduceHtml(ZILLOW));
    expect(prompt).toContain("=== PAGE DATA ===");
    expect(prompt).toContain("price: 4200");
  });

  it("never exceeds the cap", () => {
    for (const cap of [80, 500, 5_000]) {
      expect(buildPrompt(reduceHtml(ZILLOW), cap).length).toBeLessThanOrEqual(cap);
    }
  });

  it("leaves image meta out — photos have their own pipeline", () => {
    expect(buildPrompt(reduceHtml(ZILLOW))).not.toContain("og:image");
  });
});

describe("looksBlocked", () => {
  it("catches a PerimeterX interstitial served with a 200", () => {
    expect(looksBlocked(200, CAPTCHA)).toMatch(/bot check/i);
  });

  it("catches the status codes sites use to say no", () => {
    expect(looksBlocked(403, STREETEASY)).toMatch(/403/);
    expect(looksBlocked(429, STREETEASY)).toMatch(/429/);
    expect(looksBlocked(503, STREETEASY)).toMatch(/503/);
    expect(looksBlocked(404, STREETEASY)).toMatch(/404/);
  });

  it("catches an empty JavaScript shell, which is just as useless", () => {
    expect(looksBlocked(200, SHELL)).toMatch(/almost empty/i);
  });

  it("passes a real page through", () => {
    expect(looksBlocked(200, STREETEASY)).toBeNull();
    expect(looksBlocked(200, ZILLOW)).toBeNull();
  });
});
