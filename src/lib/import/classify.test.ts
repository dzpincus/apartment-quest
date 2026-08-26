import { describe, expect, it } from "vitest";
import {
  blockedNote,
  classifyFetched,
  hostLabel,
  isBlockedNote,
  landedElsewhere,
  toState,
  transitionSummary,
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
