import { describe, expect, it } from "vitest";
import {
  blockedNote,
  classifyFetched,
  classifyStructured,
  evidencePhrase,
  hasLiveSignals,
  hostLabel,
  isBlockedNote,
  landedElsewhere,
  needsModelConfirmation,
  primaryContent,
  structuredStatuses,
  toState,
  transitionSummary,
  unconfirmedNote,
  type Classification,
  type FetchedPage,
} from "./classify";

const URL_A = "https://streeteasy.com/building/214-grand-st/4b";

function page(over: Partial<FetchedPage> = {}): FetchedPage {
  return {
    status: 200,
    finalUrl: URL_A,
    originalUrl: URL_A,
    html: "<html><body><p>Nothing much</p></body></html>",
    ...over,
  };
}

const LIVE_HTML = `
  <html><head><title>214 Grand St #4B</title></head>
  <body><h1>214 Grand St #4B</h1><p>$4,200 / month</p><p>2 bd · 1 ba</p>
  <p>Available March 1</p></body></html>`;

describe("classifyFetched — the page is gone", () => {
  it("calls a 404 removed", () => {
    const out = classifyFetched(page({ status: 404 }));
    expect(out.state).toBe("removed");
    expect(out.note).toBe("streeteasy.com: page is gone (404)");
  });

  it("calls a 410 removed too", () => {
    expect(classifyFetched(page({ status: 410 })).state).toBe("removed");
  });

  it("calls a redirect to a section index removed", () => {
    const out = classifyFetched(
      page({ finalUrl: "https://streeteasy.com/for-rent", html: LIVE_HTML }),
    );
    expect(out.state).toBe("removed");
    expect(out.note).toContain("redirected to /for-rent");
  });

  it("names the home page in words rather than quoting a lone slash", () => {
    const out = classifyFetched(page({ finalUrl: "https://streeteasy.com/", html: LIVE_HTML }));
    expect(out.state).toBe("removed");
    expect(out.note).toContain("the home page");
  });

  it("beats the live-page heuristics: a 404 body full of prices is still a 404", () => {
    expect(classifyFetched(page({ status: 404, html: LIVE_HTML })).state).toBe("removed");
  });
});

describe("landedElsewhere — which redirects mean anything", () => {
  it("ignores a redirect that only added a trailing slash", () => {
    expect(landedElsewhere(URL_A, `${URL_A}/`)).toBeNull();
  });

  it("ignores a redirect that only added a query string", () => {
    expect(landedElsewhere(URL_A, `${URL_A}?utm_source=email`)).toBeNull();
  });

  it("ignores a redirect to another listing page (a canonical slug)", () => {
    expect(
      landedElsewhere(URL_A, "https://streeteasy.com/building/214-grand-street/4b"),
    ).toBeNull();
  });

  it("reports a redirect to a search index", () => {
    expect(landedElsewhere(URL_A, "https://streeteasy.com/rentals")).toBe("/rentals");
  });

  it("says nothing when the original was already a section index", () => {
    expect(
      landedElsewhere("https://streeteasy.com/for-rent", "https://streeteasy.com/"),
    ).toBeNull();
  });

  it("says nothing about an unparseable pair rather than throwing", () => {
    expect(landedElsewhere("not a url", "also not a url")).toBeNull();
  });
});

describe("classifyFetched — the page says it is over", () => {
  const phrases = [
    "This listing is no longer available.",
    "This unit is off-market.",
    "This apartment has been rented.",
    "The listing has been removed by the agent.",
    "This listing is expired.",
    "Rented on Aug 12, 2025",
    "Sold on Jan 3, 2024",
  ];

  for (const phrase of phrases) {
    it(`calls "${phrase}" off_market`, () => {
      const out = classifyFetched(page({ html: `<html><body><p>${phrase}</p></body></html>` }));
      expect(out.state).toBe("off_market");
    });
  }

  it("quotes the phrase it found, with a little of what surrounds it", () => {
    const out = classifyFetched(
      page({ html: "<html><body><h2>214 Grand St is no longer available</h2></body></html>" }),
    );
    expect(out.note).toContain("no longer available");
    expect(out.note.startsWith("streeteasy.com: ")).toBe(true);
  });

  it("wins over the price heuristic — a rented page still shows what it went for", () => {
    const out = classifyFetched(
      page({
        html: `<html><body><p>$4,200 / month</p><p>2 bd</p><p>This listing has been rented</p></body></html>`,
      }),
    );
    expect(out.state).toBe("off_market");
  });

  it("does not read a live 'available now' as a removal", () => {
    const out = classifyFetched(
      page({ html: `<html><body><p>$3,100 a month</p><p>1 bed</p><p>Available now</p></body></html>` }),
    );
    expect(out.state).toBe("active");
  });

  it("does not read 'rented in 4 days' as a removal", () => {
    const out = classifyFetched(
      page({ html: `<html><body><p>$3,100</p><p>1 bed</p><p>Rented in 4 days on average</p></body></html>` }),
    );
    expect(out.state).toBe("active");
  });
});

describe("classifyFetched — the page is still selling one", () => {
  it("calls a price plus a bedroom count active", () => {
    const out = classifyFetched(page({ html: LIVE_HTML }));
    expect(out.state).toBe("active");
    expect(out.note).toBe("streeteasy.com: price and beds still on the page");
  });

  it("reads Firecrawl markdown when there is no html", () => {
    const out = classifyFetched(
      page({ html: undefined, markdown: "# 214 Grand St\n\n$4,200/mo · 2 bd · 1 ba" }),
    );
    expect(out.state).toBe("active");
  });

  it("prefers markdown over html when both arrive", () => {
    const out = classifyFetched(
      page({ html: LIVE_HTML, markdown: "This listing is no longer available." }),
    );
    expect(out.state).toBe("off_market");
  });
});

describe("classifyFetched — ambiguous is the default, not a guess", () => {
  it("is ambiguous for a page with neither a price nor a verdict", () => {
    expect(classifyFetched(page()).state).toBe("ambiguous");
  });

  it("is ambiguous for a price with no bedroom count", () => {
    expect(
      classifyFetched(page({ html: "<html><body><p>$4,200 deposit</p></body></html>" })).state,
    ).toBe("ambiguous");
  });

  it("is ambiguous for an empty body", () => {
    const out = classifyFetched(page({ html: "", markdown: "" }));
    expect(out.state).toBe("ambiguous");
    expect(out.note).toContain("empty page");
  });

  it("ignores script contents, so a JSON blob cannot fake a live page", () => {
    const out = classifyFetched(
      page({ html: `<html><body><script>var p = "$4,200"; var b = "2 bed";</script></body></html>` }),
    );
    expect(out.state).toBe("ambiguous");
  });
});

describe("evidence is a phrase, not a window", () => {
  /** What Firecrawl actually hands back for a Zillow page that is off market. */
  const ZILLOW_MD = [
    "[Skip main navigation](https://www.zillow.com/#main)Home detailsNeighborhood",
    "",
    "Off market",
    "",
    "See all 12 photos",
    "",
    "![1st image of 959 E 79th St APT 1](https://photos.zillowstatic.com/fp/abc-cc_ft_768.jpg)",
  ].join("\n");

  const zillow = "https://www.zillow.com/homedetails/959-E-79th-St-APT-1/123_zpid/";

  it("quotes the bare phrase when what surrounds it is markup", () => {
    const out = classifyFetched(
      page({ finalUrl: zillow, originalUrl: zillow, html: undefined, markdown: ZILLOW_MD }),
    );
    expect(out.state).toBe("off_market");
    expect(out.note).toBe("zillow.com: Off market");
  });

  it("keeps the sentence when the sentence reads like one", () => {
    const out = classifyFetched(
      page({
        html:
          "<html><body><p>Note: we regret that this apartment is no longer available" +
          " as of April and will not return.</p></body></html>",
      }),
    );
    expect(out.note).toBe(
      "streeteasy.com: we regret that this apartment is no longer available as of April and will not",
    );
    // Six words each side, no more: the seventh is left out.
    expect(out.note).not.toContain("Note:");
    expect(out.note).not.toContain("return");
  });

  it("never cuts a word in half", () => {
    const text = `The management of this building has confirmed that unit 4B ${"absolutely ".repeat(6)}has been rented to another applicant`;
    const out = classifyFetched(page({ html: `<html><body><p>${text}</p></body></html>` }));
    const body = out.note.replace("streeteasy.com: ", "");
    for (const word of body.split(" ")) {
      expect(text.split(/\s+/)).toContain(word);
    }
  });

  it("stays short enough to read", () => {
    const out = classifyFetched(
      page({
        html: `<html><body><p>${"lorem ipsum ".repeat(20)}is no longer available ${"dolor sit ".repeat(20)}</p></body></html>`,
      }),
    );
    expect(out.note.replace("streeteasy.com: ", "").length).toBeLessThanOrEqual(80);
  });

  it("leaves a removed note exactly as it was", () => {
    expect(classifyFetched(page({ status: 404 })).note).toBe(
      "streeteasy.com: page is gone (404)",
    );
  });
});

describe("evidencePhrase — what the model says, cleaned up", () => {
  it("strips an image out of the middle of a phrase", () => {
    expect(
      evidencePhrase(
        "This home is ![img](https://photos.zillowstatic.com/fp/x.jpg) off market",
      ),
    ).toBe("This home is off market");
  });

  it("keeps a link's words and drops its URL", () => {
    expect(evidencePhrase("See [our rental terms](https://example.com/terms) — rented")).toBe(
      "See our rental terms — rented",
    );
  });

  it("drops heading hashes, emphasis and backticks, but not a unit number", () => {
    expect(evidencePhrase("## **214 Grand St #4B** `is` no longer available")).toBe(
      "214 Grand St #4B is no longer available",
    );
  });

  it("drops a bare URL and half an image left by a truncated page", () => {
    expect(evidencePhrase("Off market ![1st image of 959 E 79th St APT 1](htt")).toBe(
      "Off market",
    );
  });

  it("caps at 80 characters, between words", () => {
    const out = evidencePhrase("available ".repeat(20));
    expect(out.length).toBeLessThanOrEqual(80);
    expect(out.endsWith("available")).toBe(true);
  });

  it("is empty for markup with nothing to say, and the note copes", () => {
    expect(evidencePhrase("![img](https://example.com/x.jpg)")).toBe("");
  });
});

describe("blockedNote", () => {
  it("marks a note the rest of the app can recognise", () => {
    const note = blockedNote("The site refused the request (403).");
    expect(note.startsWith("blocked")).toBe(true);
    expect(isBlockedNote(note)).toBe(true);
  });

  it("does not mistake an ordinary note for a blocked one", () => {
    expect(isBlockedNote("streeteasy.com: no longer available")).toBe(false);
    expect(isBlockedNote(null)).toBe(false);
    expect(isBlockedNote(undefined)).toBe(false);
  });

  it("stays short enough for a table row", () => {
    expect(blockedNote("x".repeat(500)).length).toBeLessThanOrEqual(140);
  });
});

describe("toState — nothing the model says is trusted", () => {
  it("passes the three real states through", () => {
    expect(toState("active")).toBe("active");
    expect(toState("off_market")).toBe("off_market");
    expect(toState("removed")).toBe("removed");
  });

  it("turns anything else into unknown", () => {
    expect(toState("gone")).toBe("unknown");
    expect(toState("unknown")).toBe("unknown");
    expect(toState(null)).toBe("unknown");
    expect(toState(42)).toBe("unknown");
  });
});

describe("transitionSummary", () => {
  const label = "214 Grand St #4B";

  it("announces a listing that looks gone, with the evidence", () => {
    expect(
      transitionSummary("active", "off_market", label, "streeteasy.com: no longer available"),
    ).toBe("noticed 214 Grand St #4B looks gone (streeteasy.com: no longer available)");
  });

  it("announces one that was never checked before", () => {
    expect(transitionSummary("unknown", "removed", label, "page is gone (404)")).toBe(
      "noticed 214 Grand St #4B looks gone (page is gone (404))",
    );
    expect(transitionSummary(null, "removed", label, null)).toBe(
      "noticed 214 Grand St #4B looks gone",
    );
  });

  it("announces a relisting", () => {
    expect(transitionSummary("off_market", "active", label, "price and beds")).toBe(
      "noticed 214 Grand St #4B is back up",
    );
    expect(transitionSummary("removed", "active", label, null)).toBe(
      "noticed 214 Grand St #4B is back up",
    );
  });

  it("says nothing when the state did not move", () => {
    expect(transitionSummary("active", "active", label, "whatever")).toBeNull();
    expect(transitionSummary("off_market", "off_market", label, null)).toBeNull();
  });

  it("says nothing about off_market becoming removed — it was already gone", () => {
    expect(transitionSummary("off_market", "removed", label, "404")).toBeNull();
    expect(transitionSummary("removed", "off_market", label, "rented")).toBeNull();
  });

  it("says nothing about sliding into unknown: a wall is not news", () => {
    expect(transitionSummary("active", "unknown", label, "blocked — 403")).toBeNull();
    expect(transitionSummary("off_market", "unknown", label, null)).toBeNull();
  });

  it("says nothing about the first sight of a live listing", () => {
    expect(transitionSummary(null, "active", label, "price and beds")).toBeNull();
    expect(transitionSummary("unknown", "active", label, null)).toBeNull();
  });
});

describe("hostLabel", () => {
  it("drops the www so the note reads like a name", () => {
    expect(hostLabel("https://www.zillow.com/homedetails/x")).toBe("zillow.com");
  });

  it("is empty for something that is not a URL, and the note copes", () => {
    expect(hostLabel("nonsense")).toBe("");
    const out = classifyFetched(page({ finalUrl: "", originalUrl: "", status: 404 }));
    expect(out.note).toBe("page is gone (404)");
  });
});

// -- the false positive that caused all of this -------------------------------

/**
 * A StreetEasy **unit** page (`/building/<slug>/<unit>`), not a listing page.
 * The live listing is at the top; underneath it a price-history table lists
 * three older listings of the same apartment, and every one of those rows says
 * "No longer available" or "Delisted". Both sites embed their page data as a
 * JSON *string* inside another script, so the status codes arrive escaped —
 * `\"status\":\"ACTIVE\"` — which is the shape the fixtures below copy.
 */
const SE_HISTORY_ROWS = [
  '<a href="https://streeteasy.com/rental/4523362" data-testid="priceHistoryLink">Delisted by ERNY LLC</a>',
  '<a href="https://streeteasy.com/rental/4523362" data-testid="priceHistoryLink">No longer available</a>',
  '<a href="https://streeteasy.com/rental/3094129" data-testid="priceHistoryLink">No longer available</a>',
].join("");

function seUnitPage(statusJson: string, opts: { live?: boolean } = {}): string {
  const live = opts.live ?? true;
  return [
    "<html><head>",
    "<title>913 Saint John's Place #1R in Crown Heights, Brooklyn | StreetEasy</title>",
    '<meta property="og:description" content="Cozy 4 bedroom, 1.5 bathroom just blocks away from Brooklyn Museum."/>',
    "</head><body>",
    "<h1>913 Saint John's Place #1R</h1>",
    live ? "<p>$4,350</p><p>for rent</p><p>4 beds</p><p>Available now</p>" : "<p>4 beds</p>",
    "<h2>Price history</h2>",
    SE_HISTORY_ROWS,
    `<script>self.__next_f.push([1,"${statusJson}"])</script>`,
    "</body></html>",
  ].join("");
}

/** What the saved page actually carries: three dead history rows, one live listing. */
const SE_STATUS_JSON = [
  '{\\"date\\":\\"2024-09-04\\",\\"status\\":\\"DELISTED\\",\\"listingId\\":\\"4523362\\"},',
  '{\\"date\\":\\"2024-09-03\\",\\"status\\":\\"NO_LONGER_AVAILABLE\\",\\"listingId\\":\\"4523362\\"},',
  '{\\"id\\":\\"5144148\\",\\"pricing\\":{\\"price\\":4350},\\"status\\":\\"ACTIVE\\"}',
].join("");

describe("the StreetEasy unit page that was called gone", () => {
  const url = "https://streeteasy.com/building/913-st-johns-place-brooklyn/1r";
  const unitPage = (html: string): FetchedPage => ({
    status: 200,
    finalUrl: url,
    originalUrl: url,
    html,
  });

  it("reads the site's own status before it reads any sentence", () => {
    const out = classifyFetched(unitPage(seUnitPage(SE_STATUS_JSON)));
    expect(out.state).toBe("active");
    expect(out.note).toBe("streeteasy.com: status ACTIVE");
    expect(out.tier).toBe("structured");
  });

  it("finds the escaped status codes a real page ships", () => {
    expect(structuredStatuses("streeteasy.com", seUnitPage(SE_STATUS_JSON))).toEqual([
      "DELISTED",
      "NO_LONGER_AVAILABLE",
      "ACTIVE",
    ]);
  });

  it("keeps the price history out of the primary content", () => {
    const primary = primaryContent(unitPage(seUnitPage(SE_STATUS_JSON)));
    expect(primary).toContain("913 Saint John's Place #1R");
    expect(primary).toContain("Cozy 4 bedroom");
    expect(primary).toContain("$4,350");
  });

  it("still refuses to call it gone with the status codes stripped out", () => {
    // Belt and braces: even a site that stops shipping its status must not be
    // read off its own history table.
    const out = classifyFetched(unitPage(seUnitPage("")));
    expect(out.state).not.toBe("off_market");
  });
});

describe("classifyStructured — the site's own answer", () => {
  it("takes any live status as the answer, whatever else is on the page", () => {
    const out = classifyStructured(
      "streeteasy.com",
      '{"status":"DELISTED"} {"status":"AVAILABLE"}',
    );
    expect(out).toEqual({
      state: "active",
      note: "streeteasy.com: status AVAILABLE",
      tier: "structured",
    });
  });

  it("counts in contract and pending as live — nobody re-lists mid-application", () => {
    expect(classifyStructured("streeteasy.com", '{"status":"IN_CONTRACT"}')?.state).toBe(
      "active",
    );
    expect(classifyStructured("streeteasy.com", '{"status":"PENDING"}')?.state).toBe(
      "active",
    );
  });

  it("calls it off market only when every status on the page is a dead one", () => {
    const out = classifyStructured(
      "streeteasy.com",
      '{"status":"NO_LONGER_AVAILABLE"} {"status":"DELISTED"}',
    );
    expect(out).toEqual({
      state: "off_market",
      note: "streeteasy.com: status NO_LONGER_AVAILABLE",
      tier: "structured",
    });
  });

  it("defers when a status belongs to neither list", () => {
    expect(classifyStructured("streeteasy.com", '{"status":"SOMETHING_NEW"}')).toBeNull();
    expect(classifyStructured("streeteasy.com", '{"status":"DELISTED"} {"status":"DRAFT"}'))
      .toBeNull();
  });

  it("says nothing about a page with no status at all", () => {
    expect(classifyStructured("streeteasy.com", "<p>hello</p>")).toBeNull();
  });

  it("says nothing about a host it does not know", () => {
    expect(classifyStructured("apartments.com", '{"status":"DELISTED"}')).toBeNull();
  });

  it("reads Zillow's homeStatus, and only Zillow's", () => {
    expect(classifyStructured("www.zillow.com", '{"homeStatus":"FOR_RENT"}')?.state).toBe(
      "active",
    );
    expect(classifyStructured("zillow.com", '{"homeStatus":"RECENTLY_SOLD"}')?.state).toBe(
      "off_market",
    );
    expect(classifyStructured("zillow.com", '{"homeStatus":"OTHER"}')?.state).toBe(
      "off_market",
    );
    // StreetEasy's key on a Zillow page means nothing, and vice versa.
    expect(classifyStructured("zillow.com", '{"status":"DELISTED"}')).toBeNull();
  });

  it("beats the regex tier on a page that says both things", () => {
    const url = "https://www.zillow.com/homedetails/x/123_zpid/";
    const out = classifyFetched({
      status: 200,
      finalUrl: url,
      originalUrl: url,
      html: '<html><body><p>Similar homes recently rented on Jan 3</p><script>{"homeStatus":"FOR_RENT"}</script></body></html>',
    });
    expect(out.state).toBe("active");
    expect(out.tier).toBe("structured");
  });
});

describe("the regex tier only reads what the page is about", () => {
  const url = "https://apartments.example.com/unit/4b";
  const at = (html: string): FetchedPage => ({
    status: 200,
    finalUrl: url,
    originalUrl: url,
    html,
  });

  it("acts on a dead phrase in the primary content", () => {
    const out = classifyFetched(at("<html><body><p>This listing is no longer available.</p></body></html>"));
    expect(out.state).toBe("off_market");
    expect(out.tier).toBe("regex");
  });

  it("reads the title and the h1, not only the body text", () => {
    const out = classifyFetched(
      at("<html><head><title>4B — no longer available</title></head><body><p>hi</p></body></html>"),
    );
    expect(out.state).toBe("off_market");
  });

  it("reads og:description too", () => {
    const out = classifyFetched(
      at('<html><head><meta property="og:description" content="This unit has been rented."/></head><body><p>hi</p></body></html>'),
    );
    expect(out.state).toBe("off_market");
  });

  it("will not act on a phrase buried past the primary content", () => {
    const filler = "<p>Neighborhood facts and figures.</p>".repeat(60);
    const out = classifyFetched(
      at(`<html><body><p>$4,200</p><p>2 bd</p>${filler}<p>No longer available</p></body></html>`),
    );
    expect(out.state).toBe("ambiguous");
    expect(out.note).toContain("two stories on one page");
  });

  it("does not let the price heuristic overrule a phrase it declined to act on", () => {
    // The old bug's mirror image: "active" is a verdict too, and a page with a
    // dead sentence somewhere on it has not earned one.
    const filler = "<p>Neighborhood facts and figures.</p>".repeat(60);
    const out = classifyFetched(
      at(`<html><body><p>$4,200</p><p>2 bd</p>${filler}<p>has been rented</p></body></html>`),
    );
    expect(out.state).not.toBe("active");
  });

  it("defers when the primary content is still loudly for rent", () => {
    const out = classifyFetched(
      at(
        "<html><body><h1>4B for rent</h1><p>Apartment for rent in Brooklyn</p>" +
          "<p>See more homes for rent</p><p>Off market</p></body></html>",
      ),
    );
    expect(out.state).toBe("ambiguous");
  });

  it("defers when a live price sits beside the word available", () => {
    const out = classifyFetched(
      at("<html><body><p>$4,350</p><p>Available now</p><p>2 bd</p><p>Off market</p></body></html>"),
    );
    expect(out.state).toBe("ambiguous");
  });
});

describe("hasLiveSignals", () => {
  it("does not let 'no longer available' vouch for itself", () => {
    expect(hasLiveSignals("$4,200 — this listing is no longer available")).toBe(false);
  });

  it("counts three 'for rent's as a page still selling one", () => {
    expect(hasLiveSignals("for rent · homes for rent · apartments for rent")).toBe(true);
    expect(hasLiveSignals("for rent · homes for rent")).toBe(false);
  });

  it("wants a price and 'available' close together, not merely both present", () => {
    expect(hasLiveSignals("$4,350 Available now")).toBe(true);
    expect(hasLiveSignals(`$4,350 ${"x".repeat(2_000)} Available now`)).toBe(false);
  });
});

describe("needsModelConfirmation — which tiers stand on their own", () => {
  const gone = (tier: Classification["tier"]): Classification => ({
    state: "off_market",
    note: "streeteasy.com: no longer available",
    tier,
  });

  it("asks the model about a regex-only gone", () => {
    expect(needsModelConfirmation(gone("regex"))).toBe(true);
  });

  it("does not second-guess the site's own status code", () => {
    expect(needsModelConfirmation(gone("structured"))).toBe(false);
  });

  it("does not second-guess a 404 or a redirect", () => {
    expect(
      needsModelConfirmation({ state: "removed", note: "x", tier: "status" }),
    ).toBe(false);
    expect(
      needsModelConfirmation({ state: "removed", note: "x", tier: "redirect" }),
    ).toBe(false);
  });

  it("has nothing to confirm about a live page", () => {
    expect(
      needsModelConfirmation({ state: "active", note: "x", tier: "signals" }),
    ).toBe(false);
  });
});

describe("unconfirmedNote", () => {
  it("keeps the phrase and marks it unproven", () => {
    expect(unconfirmedNote("streeteasy.com: no longer available")).toBe(
      "unconfirmed: streeteasy.com: no longer available",
    );
  });

  it("stays short enough for a table row", () => {
    expect(unconfirmedNote("x".repeat(500)).length).toBeLessThanOrEqual(140);
  });
});
