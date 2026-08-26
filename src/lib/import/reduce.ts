/**
 * HTML -> a small pile of facts an LLM can read. Pure: no DOM, no network, no
 * dependencies, so the route handler and `reduce.test.ts` run the same code.
 *
 * Regex rather than a parser on purpose. We are not rendering the page, we are
 * pulling four things out of it (JSON-LD, meta tags, `__NEXT_DATA__`, visible
 * text) and every one of them is a well-known shape. A DOM library would be
 * 300kB in the function bundle to do the same job worse on the malformed
 * markup these sites ship.
 */

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type MetaMap = Record<string, string>;

export type Reduced = {
  /** Parsed `application/ld+json` blocks, filtered to listing-ish `@type`s. */
  jsonLd: JsonValue[];
  /** `og:*`, `twitter:*` and plain `description`. */
  meta: MetaMap;
  /** `path: value` lines pulled out of `__NEXT_DATA__` / `__PRELOADED_STATE__`. */
  facts: string[];
  /** Visible text, whitespace-collapsed. */
  text: string;
};

/** How much of the reduced page we are willing to pay Haiku to read. */
export const PROMPT_CAP = 30_000;

/**
 * `@type`s worth keeping. Everything else on a listing page is chrome —
 * `BreadcrumbList`, `WebSite`, `SearchAction` — and only costs tokens.
 */
const LD_TYPES = new Set(
  [
    "Apartment",
    "RealEstateListing",
    "Residence",
    "SingleFamilyResidence",
    "House",
    "Accommodation",
    "Offer",
    "Product",
    "Place",
    "PostalAddress",
    "Organization",
    "RealEstateAgent",
  ].map((t) => t.toLowerCase()),
);

/** Keys inside a Next.js data blob that could plausibly describe a rental. */
const FACT_KEY_RE =
  /price|rent|bed|bath|sqft|square|address|street|unit|apt|broker|agent|pet|amenit|fee|available|neighborhood|borough|zip|postal|subway|train|transit|guarantor|title|description/i;

/**
 * Bot walls. PerimeterX (`px-captcha`, `_pxhd`), Cloudflare ("Just a moment",
 * `challenge-platform`), Distil ("Pardon Our Interruption") and the generic
 * "prove you're human" interstitials all announce themselves in the body.
 */
const CAPTCHA_RE =
  /px-captcha|_pxhd|Access to this page has been denied|Just a moment\.\.\.|Just a moment…|Please verify you are a human|challenge-platform|Pardon Our Interruption|enable JavaScript and cookies to continue|unusual traffic from your computer/i;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  // Listing copy is full of these: "620 ft²", "1½ baths", "Bed–Stuy".
  sup2: "²",
  sup3: "³",
  deg: "°",
  frac12: "½",
  times: "×",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
  "#39": "'",
  "#x27": "'",
  "#34": '"',
  "#160": " ",
};

export function decodeEntities(input: string): string {
  // `[a-zA-Z][a-zA-Z0-9]*` rather than `[a-zA-Z]+`: half the entities a
  // listing page uses have a digit in the name (`&sup2;`, `&frac12;`).
  return input.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,9});/g, (match, name: string) => {
    const direct = ENTITIES[name.toLowerCase()];
    if (direct != null) return direct;
    if (name[0] === "#") {
      const code =
        name[1] === "x" || name[1] === "X"
          ? Number.parseInt(name.slice(2), 16)
          : Number.parseInt(name.slice(1), 10);
      if (Number.isFinite(code) && code > 0 && code < 0x110000) {
        return String.fromCodePoint(code);
      }
    }
    return match;
  });
}

/** Every `<script type="application/ld+json">` payload, parsed and filtered. */
export function extractJsonLd(html: string): JsonValue[] {
  const out: JsonValue[] = [];
  const re =
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(re)) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    let parsed: JsonValue;
    try {
      parsed = JSON.parse(raw) as JsonValue;
    } catch {
      continue; // a half-escaped blob is not worth a repair attempt
    }
    for (const node of flattenLd(parsed)) {
      if (keepLdNode(node)) out.push(node);
    }
  }
  return out;
}

/** JSON-LD arrives as an object, an array of objects, or an `@graph`. */
function flattenLd(value: JsonValue): JsonValue[] {
  if (Array.isArray(value)) return value.flatMap(flattenLd);
  if (value && typeof value === "object") {
    const graph = (value as Record<string, JsonValue>)["@graph"];
    if (graph) return flattenLd(graph);
    return [value];
  }
  return [];
}

function keepLdNode(node: JsonValue): boolean {
  if (!node || typeof node !== "object" || Array.isArray(node)) return false;
  const type = (node as Record<string, JsonValue>)["@type"];
  const names = Array.isArray(type) ? type : [type];
  return names.some((n) => typeof n === "string" && LD_TYPES.has(n.toLowerCase()));
}

/** `og:*` / `twitter:*` / `description`, keyed by whatever named them. */
export function extractMeta(html: string): MetaMap {
  const out: MetaMap = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key =
      attr(tag, "property") ?? attr(tag, "name") ?? attr(tag, "itemprop") ?? null;
    const content = attr(tag, "content");
    if (!key || content == null) continue;
    const k = key.toLowerCase();
    if (!/^(og:|twitter:|description$|keywords$)/.test(k)) continue;
    // First one wins: pages that repeat `og:image` list them best-first.
    if (out[k] == null) out[k] = decodeEntities(content).trim();
  }
  return out;
}

function attr(tag: string, name: string): string | null {
  const m =
    tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i")) ??
    tag.match(new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, "i")) ??
    tag.match(new RegExp(`\\b${name}\\s*=\\s*([^\\s"'>]+)`, "i"));
  return m ? (m[1] ?? null) : null;
}

/**
 * Zillow ships the whole listing in `__NEXT_DATA__`; a few older sites use
 * `window.__PRELOADED_STATE__`. Either way it is one JSON literal in a script
 * tag, which `JSON.parse` handles and a regex never should.
 */
export function extractNextData(html: string): JsonValue | undefined {
  const nextData = html.match(
    /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  const preloaded = html.match(
    /window\.__(?:PRELOADED_STATE|APOLLO_STATE|INITIAL_STATE)__\s*=\s*([\s\S]*?);?\s*<\/script>/i,
  );
  for (const raw of [nextData?.[1], preloaded?.[1]]) {
    const body = raw?.trim().replace(/;$/, "");
    if (!body) continue;
    try {
      return JSON.parse(body) as JsonValue;
    } catch {
      // fall through to the next candidate
    }
  }
  return undefined;
}

/**
 * Flatten a data blob to `path: value` lines, keeping only leaves whose key
 * looks like it describes an apartment. Depth- and count-limited: a Next.js
 * page state is megabytes of routing and experiment flags we are not paying
 * to send anywhere.
 */
export function jsonFacts(
  value: JsonValue | undefined,
  opts: { keyRe?: RegExp; maxDepth?: number; maxFacts?: number; maxValue?: number } = {},
): string[] {
  const { keyRe = FACT_KEY_RE, maxDepth = 8, maxFacts = 150, maxValue = 160 } = opts;
  if (value == null) return [];
  const seen = new Set<string>();
  const out: string[] = [];

  const walk = (node: JsonValue, path: string, depth: number) => {
    if (out.length >= maxFacts || depth > maxDepth || node == null) return;
    if (Array.isArray(node)) {
      // Ten of anything is enough to establish the shape.
      node.slice(0, 10).forEach((item, i) => walk(item, `${path}[${i}]`, depth + 1));
      return;
    }
    if (typeof node !== "object") return;
    for (const [key, child] of Object.entries(node)) {
      if (out.length >= maxFacts) return;
      const nextPath = path ? `${path}.${key}` : key;
      if (child != null && typeof child === "object") {
        walk(child, nextPath, depth + 1);
        continue;
      }
      if (!keyRe.test(key)) continue;
      if (child == null || child === "" || child === false) continue;
      const text = String(child).slice(0, maxValue);
      const line = `${nextPath}: ${text}`;
      if (seen.has(line)) continue;
      seen.add(line);
      out.push(line);
    }
  };

  walk(value, "", 0);
  return out;
}

/** Visible text: scripts, styles and site chrome removed, whitespace collapsed. */
export function visibleText(html: string): string {
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg|iframe)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(nav|footer|header)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(stripped)
    .replace(/[ \t ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function reduceHtml(html: string): Reduced {
  return {
    jsonLd: extractJsonLd(html),
    meta: extractMeta(html),
    facts: jsonFacts(extractNextData(html)),
    text: visibleText(html),
  };
}

/**
 * The prompt body. Structured data first — it is dense, reliable and cheap —
 * with whatever budget is left spent on visible text.
 */
export function buildPrompt(reduced: Reduced, cap = PROMPT_CAP): string {
  const sections: string[] = [];

  const meta = Object.entries(reduced.meta)
    .filter(([k]) => !k.startsWith("og:image") && k !== "twitter:image")
    .map(([k, v]) => `${k}: ${v}`);
  if (meta.length) sections.push(`=== META ===\n${meta.join("\n")}`);

  if (reduced.jsonLd.length) {
    sections.push(`=== JSON-LD ===\n${JSON.stringify(reduced.jsonLd).slice(0, 12_000)}`);
  }
  if (reduced.facts.length) {
    sections.push(`=== PAGE DATA ===\n${reduced.facts.join("\n")}`);
  }

  const head = sections.join("\n\n");
  const room = cap - head.length - 20;
  if (room <= 0) return head.slice(0, cap);
  const text = reduced.text.slice(0, room);
  return text ? `${head}${head ? "\n\n" : ""}=== PAGE TEXT ===\n${text}` : head;
}

/**
 * Did we get a listing, or a wall? Returns the human-facing reason when the
 * answer is "a wall", `null` when the page looks real.
 *
 * The last branch is the sneaky one: some sites return 200 with a shell that
 * only fills in from JavaScript. That is not blocked, exactly, but it is just
 * as useless, and the paste path is the same fix.
 */
export function looksBlocked(status: number, body: string): string | null {
  if (status === 403) return "The site refused the request (403).";
  if (status === 429) return "The site rate-limited us (429).";
  if (status === 503) return "The site is refusing robots right now (503).";
  if (status >= 400) return `The site returned ${status}.`;
  if (CAPTCHA_RE.test(body)) return "The site showed a bot check instead of the listing.";
  if (
    body.length < 15_000 &&
    !/og:title/i.test(body) &&
    !/application\/ld\+json/i.test(body)
  ) {
    return "The page came back almost empty — it renders in the browser, not on the wire.";
  }
  return null;
}
