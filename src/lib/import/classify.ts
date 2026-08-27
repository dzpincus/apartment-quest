import "server-only";

/**
 * Is this listing still up? Three tiers, cheapest first.
 *
 * 1. **Structured** (`classifyStructured`). StreetEasy and Zillow ship the
 *    listing's own status code in the page's JSON, and a machine-readable
 *    `"status":"ACTIVE"` beats any sentence we could pattern-match. Site-aware
 *    by necessity: the key and its vocabulary belong to the site.
 * 2. **Regex** (`classifyFetched`, pure and tested). A 404 is a 404, a
 *    redirect to `/for-rent` is a listing that stopped existing, and "no
 *    longer available" is a sentence every rental site writes in more or less
 *    the same words. Most checks end here and cost nothing.
 * 3. **Haiku** (`classifyWithModel`), only for the pages that say neither.
 *    Same SDK, same model and the same forced-tool trick as the import — the
 *    model picks one of four states and quotes the line it picked it from.
 *
 * The bar for calling something gone is deliberately high. `active` means the
 * page still reads like a live listing; anything the code cannot justify is
 * `unknown`, and `unknown` never produces an activity row, never moves a
 * listing into the Vanished? section and never touches `status`. A false
 * "gone" costs a real apartment; a false "unknown" costs one more check
 * twelve hours later.
 *
 * **The lesson that shaped tiers 1 and 2.** A live StreetEasy unit page
 * (`/building/913-st-johns-place-brooklyn/1r`) was called `off_market` on the
 * strength of "No longer available" — three occurrences, every one of them a
 * row in the *price history* table describing a 2024 listing of the same
 * apartment. The current listing was `"status":"ACTIVE"` and $4,350 for rent
 * at the top of the page. So: the site's own status code is read first, and
 * the dead-listing regexes only ever look at the page's **primary content**
 * (title, `<h1>`, `og:description`, the first `PRIMARY_TEXT_CAP` characters of
 * visible text) — never at a history table nine screens down.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { ListingState } from "@/lib/types";
import {
  anthropicClient,
  extractionErrorFor,
  ExtractionError,
  IMPORT_MODEL,
} from "./extract";
import { NOTE_CAP, UNCONFIRMED_PREFIX } from "@/lib/sync-types";
import { extractMeta, visibleText } from "./reduce";

/** `ambiguous` is not a state a listing can hold — it means "ask the model". */
export type Verdict = ListingState | "ambiguous";

/**
 * Which tier reached the verdict. The route reads it: a `off_market` that only
 * `regex` believes in has to be confirmed by the model before it moves a
 * listing, because that is the one tier that has been wrong about a live page.
 */
export type ClassifyTier =
  /** The HTTP status itself — a 404 or a 410. */
  | "status"
  /** A redirect that landed on a section index. */
  | "redirect"
  /** The site's own machine-readable status code. */
  | "structured"
  /** A dead-listing phrase in the page's primary content. */
  | "regex"
  /** A price and a bedroom count, with nothing contradicting them. */
  | "signals"
  /** Nothing decided it. `state` is `ambiguous` or the model's own answer. */
  | "none";

export type Classification = {
  state: Verdict;
  /** What goes in `state_note`: short, quotable, in the page's own words. */
  note: string;
  tier: ClassifyTier;
};

export type FetchedPage = {
  status: number;
  /** Where the fetch actually ended up, after redirects. */
  finalUrl: string;
  /** The URL stored on the listing. */
  originalUrl: string;
  html?: string;
  markdown?: string;
};

/** How much of a page the model is asked to read. Plenty for a banner. */
export const CLASSIFY_CAP = 8_000;
const CLASSIFY_MAX_TOKENS = 256;
const CLASSIFY_TOOL = "classify_listing";

/**
 * The sentence a dead listing writes. Kept narrow on purpose: "available" and
 * "rented" on their own appear on perfectly live pages ("available now",
 * "rented in 3 days"), so every branch here needs a companion word.
 */
const OFF_MARKET_RE =
  /no longer available|off[- ]market|has been (?:rented|removed|taken off)|listing (?:is )?(?:inactive|expired|unavailable)|rented on|sold on/i;

/** The same pattern, global, for scrubbing dead phrases out of a live-signal count. */
const OFF_MARKET_RE_G = new RegExp(OFF_MARKET_RE.source, "gi");

/** A page that still quotes a price and a bedroom count is still selling one. */
const PRICE_RE = /\$\d{1,2},?\d{3}/;
const BEDS_RE = /\b\d+\s*(?:bd|bed)/i;

/**
 * How much of the page counts as what it is *about*. A banner saying the
 * apartment is gone is at the top; a price-history table describing three
 * older listings of the same unit is not, and it was reading that table that
 * put a live apartment in the Vanished section.
 */
export const PRIMARY_TEXT_CAP = 1_500;

/** How far apart a price and the word "available" may be and still be one claim. */
const NEAR_CHARS = 800;

/** "for rent" this many times in the primary content is a page still selling one. */
const FOR_RENT_MIN = 3;

/**
 * A path that is a whole section of the site rather than one apartment. Landing
 * on one of these after a redirect is how Zillow and StreetEasy say "that page
 * is gone" without saying it.
 */
const NON_LISTING_PATH_RE =
  /^\/(?:for-rent|for_rent|rent|rentals?|home|homes|apartment|apartments|search|listing|listings|building|buildings|nyc|new-york-city|new-york|error|404)?\/?$/i;

// -- tiers 1 and 2: the site's own status code, then the words ----------------

export function classifyFetched(page: FetchedPage): Classification {
  const host = hostLabel(page.finalUrl || page.originalUrl);

  if (page.status === 404 || page.status === 410) {
    return {
      state: "removed",
      note: note(host, `page is gone (${page.status})`),
      tier: "status",
    };
  }

  const landing = landedElsewhere(page.originalUrl, page.finalUrl);
  if (landing) {
    return {
      state: "removed",
      note: note(host, `redirected to ${landing}`),
      tier: "redirect",
    };
  }

  // The site's own answer, before any of ours. Only the raw HTML carries it —
  // the status lives in a script tag, which `visibleText` throws away.
  const structured = page.html ? classifyStructured(host, page.html) : null;
  if (structured) return structured;

  // Firecrawl hands back markdown; a direct fetch hands back HTML. Either way
  // what the regexes want is the words, not the markup.
  const text = page.markdown?.trim()
    ? page.markdown
    : page.html
      ? visibleText(page.html)
      : "";
  if (!text.trim()) {
    return { state: "ambiguous", note: note(host, "empty page"), tier: "none" };
  }

  // Dead-listing phrases count only in what the page is *about*. Anywhere else
  // they are somebody's price history, a "recently rented nearby" strip, or a
  // footer link to the site's rented archive.
  const primary = primaryContent(page, text);
  const gone = OFF_MARKET_RE.exec(primary);
  if (gone && !hasLiveSignals(primary)) {
    return {
      state: "off_market",
      note: note(host, phraseAround(primary, gone)),
      tier: "regex",
    };
  }

  // A dead phrase we would not act on — because it sat outside the primary
  // content, or because the primary content argues loudly with it — must not
  // then be *overruled* by the price heuristic either. That is a page with two
  // stories on it, which is precisely what the model is for.
  const contested = Boolean(gone) || OFF_MARKET_RE.test(text);
  if (contested) {
    return { state: "ambiguous", note: note(host, "two stories on one page"), tier: "none" };
  }

  if (PRICE_RE.test(text) && BEDS_RE.test(text)) {
    return {
      state: "active",
      note: note(host, "price and beds still on the page"),
      tier: "signals",
    };
  }

  return { state: "ambiguous", note: note(host, "no price, no verdict"), tier: "none" };
}

/**
 * A verdict the regex tier reached on its own is not enough to move a listing
 * into the Vanished section: `/api/sync` asks the model to agree first. The
 * other tiers stand on their own — a 404 is not an opinion, and a site saying
 * `"status":"DELISTED"` about its own listing is not a turn of phrase.
 */
export function needsModelConfirmation(first: Classification): boolean {
  return first.state === "off_market" && first.tier === "regex";
}

/** The note for a "gone" nobody could confirm. `unknown` is what gets written. */
export function unconfirmedNote(raw: string): string {
  return `${UNCONFIRMED_PREFIX} ${raw.trim()}`.slice(0, NOTE_CAP);
}

// -- tier 1: the site's own status code ---------------------------------------

/**
 * Statuses that mean somebody can still rent this. `IN_CONTRACT` / `PENDING`
 * are in here deliberately: an apartment under application is not one we
 * should move to Vanished while a housemate is mid-paperwork.
 */
const LIVE_STATUSES = ["AVAILABLE", "ACTIVE", "IN_CONTRACT", "PENDING"];

const DEAD_STATUSES = [
  "NO_LONGER_AVAILABLE",
  "RENTED",
  "OFF_MARKET",
  "DELISTED",
  "EXPIRED",
  "TEMPORARILY_OFF_MARKET",
];

type StructuredRule = {
  /** Host suffix this rule speaks for. */
  host: string;
  /** The JSON key carrying the verdict, and what its values mean. */
  key: string;
  live: ReadonlySet<string>;
  dead: ReadonlySet<string>;
};

const STRUCTURED_RULES: StructuredRule[] = [
  {
    host: "streeteasy.com",
    key: "status",
    live: new Set(LIVE_STATUSES),
    dead: new Set(DEAD_STATUSES),
  },
  {
    host: "zillow.com",
    key: "homeStatus",
    live: new Set(["FOR_RENT", "FOR_SALE", "PENDING", "ACTIVE"]),
    dead: new Set([...DEAD_STATUSES, "OTHER", "RECENTLY_SOLD", "SOLD", "FORECLOSED"]),
  },
];

/**
 * `"status":"ACTIVE"` — or `\"status\":\"ACTIVE\"`, which is what it actually
 * looks like, because both sites serve their page data as a JSON *string*
 * embedded in another script. Matching only the unescaped form would have
 * found nothing at all on the page that caused this.
 */
function statusRegex(key: string): RegExp {
  return new RegExp(`\\\\?"${key}\\\\?"\\s*:\\s*\\\\?"([A-Z_]+)`, "g");
}

/** Every status code the page states about itself, in the order they appear. */
export function structuredStatuses(host: string, html: string): string[] {
  const rule = ruleFor(host);
  if (!rule) return [];
  return [...html.matchAll(statusRegex(rule.key))].map((m) => m[1] as string);
}

function ruleFor(host: string): StructuredRule | null {
  const h = host.toLowerCase();
  return (
    STRUCTURED_RULES.find((rule) => h === rule.host || h.endsWith(`.${rule.host}`)) ??
    null
  );
}

/**
 * What the site says about its own listing, or null when it did not say.
 *
 * **Any** live status wins. A unit page carries the whole history of the
 * apartment — three dead listings and one live one — and the live one is the
 * only one anybody can rent, so it is the only one worth a verdict. The
 * converse needs unanimity: every status on the page has to be a dead one
 * before we will call the page dead, and a code from neither list (`DRAFT`,
 * `COMPLETED`, a value the site added last week) is enough to make us defer.
 */
export function classifyStructured(host: string, html: string): Classification | null {
  const rule = ruleFor(host);
  if (!rule) return null;
  const statuses = structuredStatuses(host, html);
  if (statuses.length === 0) return null;

  const live = statuses.find((s) => rule.live.has(s));
  if (live) {
    return { state: "active", note: note(host, `status ${live}`), tier: "structured" };
  }
  if (statuses.every((s) => rule.dead.has(s))) {
    return {
      state: "off_market",
      note: note(host, `status ${statuses[0]}`),
      tier: "structured",
    };
  }
  return null;
}

// -- primary content ----------------------------------------------------------

/**
 * What the page is about, as opposed to what is also on it: the `<title>`,
 * every `<h1>`, the `og:description`, and the opening of the visible text.
 *
 * `body` is passed in rather than recomputed — `classifyFetched` has already
 * paid for `visibleText` once, and on a 450KB page that is not a free call.
 */
export function primaryContent(page: FetchedPage, body?: string): string {
  const parts: string[] = [];
  const html = page.html ?? "";

  if (html) {
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    if (title) parts.push(tagText(title));
    for (const heading of html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)) {
      parts.push(tagText(heading[1] ?? ""));
    }
    const meta = extractMeta(html);
    const description = meta["og:description"] ?? meta["description"];
    if (description) parts.push(description);
  }

  const text =
    body ??
    (page.markdown?.trim() ? page.markdown : html ? visibleText(html) : "");
  parts.push(text.slice(0, PRIMARY_TEXT_CAP));

  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n");
}

/** Tag soup inside a `<title>` or `<h1>` — strip it and decode the entities. */
function tagText(raw: string): string {
  return visibleText(raw).replace(/\s+/g, " ").trim();
}

/**
 * Is the primary content still, loudly, selling an apartment? If so a dead
 * phrase beside it is a contradiction rather than a verdict, and the model
 * gets to read the whole thing.
 *
 * The dead phrases are scrubbed before the count, because "no longer
 * available" contains the word "available" and would otherwise vouch for
 * itself.
 */
export function hasLiveSignals(primary: string): boolean {
  const scrubbed = primary.replace(OFF_MARKET_RE_G, " ");
  const forRent = scrubbed.match(/\bfor rent\b/gi);
  if (forRent && forRent.length >= FOR_RENT_MIN) return true;

  for (const price of scrubbed.matchAll(/\$\d{1,2},\d{3}/g)) {
    const from = Math.max(0, price.index - NEAR_CHARS);
    const to = price.index + price[0].length + NEAR_CHARS;
    if (/\bavailable\b/i.test(scrubbed.slice(from, to))) return true;
  }
  return false;
}

/**
 * A redirect that landed on a section index — `/for-rent`, `/rentals`, the
 * home page. Returns the path to quote, or null when the trip was ordinary
 * (a canonical slug, a trailing slash, an added query string).
 */
export function landedElsewhere(
  originalUrl: string,
  finalUrl: string,
): string | null {
  if (!finalUrl || finalUrl === originalUrl) return null;
  let from: URL;
  let to: URL;
  try {
    from = new URL(originalUrl);
    to = new URL(finalUrl);
  } catch {
    return null;
  }
  const fromPath = trimSlash(from.pathname);
  const toPath = trimSlash(to.pathname);
  if (fromPath === toPath) return null;
  // The original was already a section index — we never had a listing page to
  // lose, so a redirect tells us nothing.
  if (NON_LISTING_PATH_RE.test(from.pathname)) return null;
  if (!NON_LISTING_PATH_RE.test(to.pathname)) return null;
  return to.pathname === "/" ? "the home page" : to.pathname;
}

/**
 * The note for a check that never saw the page, and the predicate that reads it
 * back. Both live in `sync-types.ts` — the detail page needs the predicate and
 * cannot import this module — and are re-exported here because this is where
 * notes are written and where the tests look for them.
 */
export { blockedNote, isBlockedNote } from "@/lib/sync-types";

// -- tier 2: the model --------------------------------------------------------

const SYSTEM = [
  "You are told what a rental listing page currently says, and you decide whether the",
  "listing is still on the market.",
  "",
  "States:",
  '- "active": the page is still advertising this specific apartment for rent.',
  '- "off_market": the page exists but says the apartment is rented, in contract, no',
  "  longer available, expired, or otherwise not being offered.",
  '- "removed": the listing page itself is gone — an error page, a "not found", or a',
  "  search/section page where a listing used to be.",
  '- "unknown": the text is a bot check, a cookie wall, a login page, an empty shell,',
  "  or simply does not say either way.",
  "",
  "Rules:",
  "- Never guess. Anything you cannot justify from the text is \"unknown\".",
  '- A price and a bedroom count with no contrary statement means "active".',
  '- "Available now", "available March 1" and "rented in 5 days" describe a LIVE',
  "  listing. Do not read them as removals.",
  "- Similar apartments, recently rented nearby, and price history sections describe",
  "  OTHER apartments. Judge only the listing the page is about.",
  "- Listing pages often include a price history or 'previous listings' section describing",
  "  OLDER listings of the same unit as 'No longer available' or 'Rented'. Those do not",
  "  mean the current listing is gone. Classify off_market only if the CURRENT listing (the",
  "  one the page is primarily about, usually with the main price and 'Available'/'For rent'",
  "  controls) is marked unavailable.",
  "- evidence: a quoted phrase from the page that decided it, at most 12 words, with no",
  "  markup — no image or link syntax, no URLs, no stray punctuation. Quote it as closely",
  '  as you can. For "active" say what is still being advertised.',
].join("\n");

const TOOL: Anthropic.Tool = {
  name: CLASSIFY_TOOL,
  description: "Record whether this rental listing is still on the market.",
  input_schema: {
    type: "object",
    properties: {
      state: {
        type: "string",
        enum: ["active", "off_market", "removed", "unknown"],
      },
      evidence: {
        type: "string",
        description:
          "A quoted phrase from the page that decided it: at most 12 words, no markup.",
      },
    },
    required: ["state", "evidence"],
  },
};

type ClassifyToolInput = { state?: unknown; evidence?: unknown };

/**
 * `text` is the reduced page (`buildPrompt`, or Firecrawl's markdown), capped
 * at `CLASSIFY_CAP` — a "no longer available" banner is at the top of the
 * page, never on page nine.
 */
export async function classifyWithModel(
  text: string,
  opts: { url?: string | null } = {},
): Promise<{ state: ListingState; note: string; usage: { input_tokens: number; output_tokens: number } }> {
  if (!text.trim()) throw new ExtractionError("There was nothing to read.");
  const client = anthropicClient();
  const host = hostLabel(opts.url ?? "");

  const header = opts.url
    ? `The text below is what ${opts.url} says right now.\n\n`
    : "The text below is what a listing page says right now.\n\n";

  let message: Anthropic.Message;
  try {
    message = await client.messages.create({
      model: IMPORT_MODEL,
      max_tokens: CLASSIFY_MAX_TOKENS,
      temperature: 0,
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: { type: "tool", name: CLASSIFY_TOOL },
      messages: [{ role: "user", content: `${header}${text.slice(0, CLASSIFY_CAP)}` }],
    });
  } catch (error) {
    throw extractionErrorFor(error);
  }

  const block = message.content.find(
    (part): part is Anthropic.ToolUseBlock =>
      part.type === "tool_use" && part.name === CLASSIFY_TOOL,
  );
  if (!block) throw new ExtractionError("The model didn't return a verdict.");

  const input = block.input as ClassifyToolInput;
  const usage = {
    input_tokens: message.usage.input_tokens,
    output_tokens: message.usage.output_tokens,
  };
  console.info("[sync] classify", {
    model: IMPORT_MODEL,
    chars: Math.min(text.length, CLASSIFY_CAP),
    state: input.state,
    ...usage,
  });

  return {
    // Nothing the model says is trusted: an off-schema state is an absence.
    state: toState(input.state),
    // The model is asked for a bare phrase and sometimes hands back markdown anyway.
    note: note(host, evidencePhrase(typeof input.evidence === "string" ? input.evidence : "")),
    usage,
  };
}

/** A model answer that is not one of the four states is `unknown`, not a throw. */
export function toState(value: unknown): ListingState {
  return value === "active" || value === "off_market" || value === "removed"
    ? value
    : "unknown";
}

// -- transitions --------------------------------------------------------------

/**
 * The feed line for a state change, or null when the change is not an
 * impression. Pure — the route writes whatever this returns and nothing else
 * decides what is worth saying.
 *
 * Two things are worth saying: a listing that looks gone, and a listing that
 * came back. Everything else — an unchanged state, a first look, anything
 * sliding into `unknown` because a site put up a wall — is noise, and a feed
 * that fills with noise twice a day is a feed nobody reads.
 */
export function transitionSummary(
  prev: ListingState | null | undefined,
  next: ListingState,
  label: string,
  note?: string | null,
): string | null {
  const before = prev ?? "unknown";
  if (before === next) return null;

  const goneNow = next === "off_market" || next === "removed";
  const goneBefore = before === "off_market" || before === "removed";

  if (goneNow && !goneBefore) {
    const evidence = (note ?? "").trim();
    return evidence
      ? `noticed ${label} looks gone (${evidence})`
      : `noticed ${label} looks gone`;
  }
  if (goneBefore && next === "active") return `noticed ${label} is back up`;
  return null;
}

// -- helpers ------------------------------------------------------------------

/** `https://streeteasy.com/x` -> `streeteasy.com`. Empty string when unparseable. */
export function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

function note(host: string, detail: string): string {
  const body = detail.replace(/\s+/g, " ").trim() || "no evidence";
  return (host ? `${host}: ${body}` : body).slice(0, NOTE_CAP);
}

/**
 * Longest phrase we quote as evidence, before the host label goes in front of
 * it. `NOTE_CAP` is what a table row can hold; this is what a person can read.
 */
const EVIDENCE_CAP = 80;

/** How much of what surrounds the matched phrase is worth quoting, in words. */
const CONTEXT_WORDS = 6;

/**
 * Context that is page furniture rather than a sentence: leftover markdown
 * link or image syntax, a URL, or so few letters that whatever we captured was
 * a nav bar, a price strip or a pile of photo counts.
 */
function isJunkContext(context: string): boolean {
  if (/\]\(|!\[|https?:|www\./i.test(context)) return true;
  const letters = context.replace(/[^a-z]/gi, "").length;
  return letters < context.length * 0.4;
}

/**
 * Markdown out, whitespace collapsed. Firecrawl hands back a page written in
 * markdown, and an image between two sentences is `![alt](https://…)` — 200
 * characters of URL nobody wants to read in an activity feed.
 */
export function stripMarkup(raw: string): string {
  return raw
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images, whole
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links keep their label
    .replace(/!\[[^\]]*\](?:\([^)]*)?/g, " ") // an image a window cut in half
    .replace(/\]\([^)]*\)?/g, " ") // a link a window cut in half
    .replace(/!\[/g, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[[\]]/g, " ")
    .replace(/[*`]+/g, " ")
    .replace(/#+(?=\s|$)/g, " ") // heading hashes, but not "#4B"
    .replace(/\s+/g, " ")
    .trim();
}

/** `EVIDENCE_CAP` characters at most, cut between words rather than inside one. */
function capPhrase(text: string): string {
  if (text.length <= EVIDENCE_CAP) return text;
  const cut = text.slice(0, EVIDENCE_CAP);
  const space = cut.lastIndexOf(" ");
  return (space > 0 ? cut.slice(0, space) : cut).replace(/\s+$/, "");
}

/** A phrase fit to quote: no markup, no half-words, short enough to read. */
export function evidencePhrase(raw: string): string {
  return capPhrase(stripMarkup(raw));
}

/**
 * The matched phrase, with up to `CONTEXT_WORDS` words either side when those
 * words are a sentence — and the bare phrase when they are not. A window cut
 * by character count lands mid-word and mid-URL ("atorHome detailsNeighborhood
 * Off market … ![1st image of 959 E 79th St](htt"), which is how a correct
 * verdict ends up looking like a bug.
 */
function phraseAround(text: string, match: RegExpExecArray): string {
  const bare = evidencePhrase(match[0]) || match[0];
  const before = text.slice(0, match.index);
  const after = text.slice(match.index + match[0].length);
  const lead = tailWords(before);
  const trail = headWords(after);
  const context = [lead, match[0], trail].filter(Boolean).join(" ");
  if (isJunkContext(context)) return bare;
  return evidencePhrase(context) || bare;
}

/** The last few whole words before the match. A word glued to it is a fragment. */
function tailWords(before: string): string {
  const words = before.split(/\s+/).filter(Boolean);
  if (before && !/\s$/.test(before)) words.pop();
  return words.slice(-CONTEXT_WORDS).join(" ");
}

/** The first few whole words after the match, on the same terms. */
function headWords(after: string): string {
  const words = after.split(/\s+/).filter(Boolean);
  if (after && !/^\s/.test(after)) words.shift();
  return words.slice(0, CONTEXT_WORDS).join(" ");
}

function trimSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}
