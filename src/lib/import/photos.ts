/**
 * Photo discovery. Pure: HTML in, a short ordered list of image URLs out. The
 * route hands the list to the panel, the user unticks the junk, Part 3 copies
 * what survives into Supabase Storage.
 *
 * The hard part is not finding images — a listing page has two hundred — it is
 * finding the *eight* that are the apartment. Four rules do the work:
 *
 *  a. A candidate's path must end in a picture extension (`.jpg`, `.png`,
 *     `.webp`, `.avif`, `.gif`; a query string may follow). No exceptions: a
 *     media-CDN hostname is a hint about *ordering*, never a way past this.
 *     Zillow serves its bundles from `zillowstatic.com` too, and trusting the
 *     host alone is how `core-dff2c6af.js` ends up in a photo grid.
 *  b. Anything that is obviously page furniture — `/s3/pfs/`, `/vrmodels/`,
 *     `/static/images/`, an SDK, a logo, an icon, a map, an avatar, a tracking
 *     pixel — is dropped on sight, hostname included.
 *  c. One URL per photo. Zillow publishes seventeen renditions of every
 *     picture (`-cc_ft_192` … `-cc_ft_1536`, `-p_d`, each as jpg and webp), so
 *     candidates are grouped by the hash in `/fp/<hash>-<variant>.<ext>` and
 *     the best rendition *that the page actually offered* wins. We never
 *     synthesise a URL: a rendition Zillow did not list may not exist.
 *  d. Page order, hero first. The `og:image` leads if it survived (a) and (b);
 *     everything else follows the first appearance of its photo in the markup.
 */

import { extractMeta, extractNextData, type JsonValue } from "./reduce";

/** The panel shows a 4-wide grid; three rows is plenty to pick from. */
export const PHOTO_CAP = 12;

/** Below this a "photo" is a sprite, a badge or a tracking pixel. */
const MIN_WIDTH = 300;

/** Rule (a), against a parsed `pathname` — the query lives elsewhere. */
const IMAGE_PATH_RE = /\.(?:jpe?g|png|webp|avif|gif)$/i;

/** Rule (a), against a raw string, where a query string may still be attached. */
const IMAGE_URL_RE = /\.(?:jpe?g|png|webp|avif|gif)(?:$|[?#])/i;

/**
 * Every absolute image URL in the markup, in the order it appears. Zillow's
 * photos live inside a JSON string inside `__NEXT_DATA__`, three levels of
 * escaping from anything a walker can reach, so the sweep is the only thing
 * that finds them. Rules (a)–(c) are what make that safe.
 */
const SWEEP_RE =
  /https?:\/\/[^\s"'<>()\\\]}]+?\.(?:jpe?g|png|webp|avif|gif)(?:\?[^\s"'<>()\\\]}]*)?/gi;

/** Hosts that usually serve listing media. A tie-breaker, never a bypass. */
const CDN_HOST_RE =
  /(?:^|\.)(?:zillowstatic\.com|streeteasy\.com|cloudfront\.net|cloudinary\.com|imgix\.net)$|^(?:images?|img|media|photos?|cdn)\./i;

/**
 * Rule (b). Tested against `hostname + pathname`, because half of these
 * announce themselves in the host (`cdn.pubnub.com`, `maps.googleapis.com`,
 * `analytics.example.com`) and the other half in the path.
 */
const ASSET_RE =
  /\/s3\/pfs\/|\/vrmodels\/|\/static\/images\/|\/assets\/|\/xhr\/|\.(?:js|css|svg)$|sdk|pubnub|analytics|tracking|telemetry|beacon|collector|noscript|logo|icon|sprite|badge|pixel|placeholder|avatar|map|blank|spacer|favicon|watermark|1x1/i;

/**
 * `/fp/<hash>-<variant>.<ext>` — the shape of every Zillow photo URL. The hash
 * identifies the picture; the variant is which crop and how wide.
 */
const ZILLOW_FP_RE =
  /^\/fp\/(.+?)-(uncropped_scaled_within_(\d+)_\d+|cc_ft_(\d+)|p_[a-z])\.(?:jpe?g|png|webp|avif)$/i;

/** `…-large.jpg` and friends: a size when the URL declares no number. */
const SIZE_WORDS: [RegExp, number][] = [
  [/[-_](?:orig|original|full)(?=\.)/i, 6],
  [/[-_]x?xlarge(?=\.)/i, 5],
  [/[-_]large(?=\.)/i, 4],
  [/[-_]medium(?=\.)/i, 3],
  [/[-_]small(?=\.)/i, 2],
  [/[-_](?:thumb|thumbnail|tiny)(?=\.)/i, 1],
];

type Candidate = { url: string; width: number | null; pos?: number };

/** One photo: every rendition of it the page offered, reduced to the best. */
type Group = {
  url: string;
  score: number;
  /** The widest rendition we saw — how we tell a photo from a badge. */
  width: number | null;
  /** First appearance in the markup, which is the order the page intended. */
  pos: number;
  /** 0 = the hero, 1 = a known media host, 2 = everything else. */
  tier: number;
};

export function discoverPhotos(
  html: string,
  opts: string | { cap?: number; baseUrl?: string | null } = {},
): string[] {
  // Callers reasonably pass the page URL itself; treat that as the base.
  const options = typeof opts === "string" ? { baseUrl: opts } : opts;
  const cap = options.cap ?? PHOTO_CAP;
  const base = options.baseUrl ?? null;

  // One un-escaped copy of the page: `https:\/\/…` inside embedded JSON is the
  // same URL, and positions taken from this copy stay in page order.
  const page = html.includes("\\")
    ? html.replace(/\\u002[fF]/gi, "/").replace(/\\\//g, "/")
    : html;

  const hero = heroUrl(html, base);
  const candidates: Candidate[] = [
    ...fromMeta(html),
    ...fromJsonLd(html),
    ...fromNextData(html),
    ...fromMarkupTags(html),
    ...fromSweep(page),
  ];

  const groups = new Map<string, Group>();
  candidates.forEach((candidate, order) => {
    const url = normalize(candidate.url, base);
    if (!url) return;
    const parsed = safeParse(url);
    if (!parsed) return;
    if (!IMAGE_PATH_RE.test(parsed.pathname)) return; // rule (a)
    const host = parsed.hostname.toLowerCase();
    if (ASSET_RE.test(`${host}${parsed.pathname.toLowerCase()}`)) return; // rule (b)

    const width = candidate.width ?? widthHint(parsed);
    const score = variantScore(parsed, width);
    const pos = candidate.pos ?? locate(page, candidate.url, order);
    const tier = url === hero ? 0 : CDN_HOST_RE.test(host) ? 1 : 2;

    const key = groupKey(parsed);
    const current = groups.get(key);
    if (!current) {
      groups.set(key, { url, score, width, pos, tier });
      return;
    }
    if (score > current.score) {
      current.url = url;
      current.score = score;
    }
    if (width != null && (current.width == null || width > current.width)) {
      current.width = width;
    }
    current.pos = Math.min(current.pos, pos);
    current.tier = Math.min(current.tier, tier);
  });

  return [...groups.values()]
    .filter((group) => group.width == null || group.width >= MIN_WIDTH)
    .sort((a, b) => a.tier - b.tier || a.pos - b.pos)
    .slice(0, cap)
    .map((group) => group.url);
}

/** The one image the page explicitly claims is *the* image, if it qualifies. */
function heroUrl(html: string, base: string | null): string | null {
  const meta = extractMeta(html);
  for (const key of ["og:image:secure_url", "og:image", "og:image:url", "twitter:image"]) {
    const value = meta[key];
    if (!value) continue;
    const url = normalize(value, base);
    const parsed = url ? safeParse(url) : null;
    if (!parsed) continue;
    if (!IMAGE_PATH_RE.test(parsed.pathname)) continue;
    const host = parsed.hostname.toLowerCase();
    if (ASSET_RE.test(`${host}${parsed.pathname.toLowerCase()}`)) continue;
    return url;
  }
  return null;
}

function fromMeta(html: string): Candidate[] {
  const meta = extractMeta(html);
  const keys = ["og:image:secure_url", "og:image", "og:image:url", "twitter:image"];
  const out: Candidate[] = [];
  for (const key of keys) {
    const value = meta[key];
    if (value) out.push({ url: value, width: null });
  }
  // `extractMeta` keeps only the first of each tag; pages that list every
  // photo as a repeated `og:image` need the raw sweep too.
  for (const tag of html.match(/<meta\b[^>]*og:image[^>]*>/gi) ?? []) {
    const content = tag.match(/content\s*=\s*["']([^"']+)["']/i)?.[1];
    if (content) out.push({ url: content, width: null });
  }
  return out;
}

function fromJsonLd(html: string): Candidate[] {
  const out: Candidate[] = [];
  const re =
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(re)) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    let parsed: JsonValue;
    try {
      parsed = JSON.parse(raw) as JsonValue;
    } catch {
      continue;
    }
    collectImageKeys(parsed, out, 0);
  }
  return out;
}

/** `image` / `photo` / `contentUrl` anywhere in a JSON-LD graph. */
function collectImageKeys(node: JsonValue, out: Candidate[], depth: number): void {
  if (depth > 8 || node == null) return;
  if (Array.isArray(node)) {
    for (const item of node) collectImageKeys(item, out, depth + 1);
    return;
  }
  if (typeof node !== "object") return;
  for (const [key, value] of Object.entries(node)) {
    if (/^(image|photo|photos|images|contentUrl|thumbnailUrl)$/i.test(key)) {
      pushImageValue(value, out, 0);
      continue;
    }
    collectImageKeys(value, out, depth + 1);
  }
}

function pushImageValue(value: JsonValue, out: Candidate[], depth: number): void {
  if (depth > 4 || value == null) return;
  if (typeof value === "string") {
    out.push({ url: value, width: null });
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) pushImageValue(item, out, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  const record = value as Record<string, JsonValue>;
  const url = record.url ?? record.contentUrl;
  const width = typeof record.width === "number" ? record.width : null;
  if (typeof url === "string") out.push({ url, width });
}

/**
 * A parsed data blob is the one place a rendition's *width* is stated rather
 * than guessed, which is worth the walk even though the sweep will find the
 * same URLs. Strings must still look like images: everything else in that blob
 * is analytics.
 */
function fromNextData(html: string): Candidate[] {
  const data = extractNextData(html);
  if (data == null) return [];
  const out: Candidate[] = [];
  const seen = new Set<string>();

  const walk = (node: JsonValue, depth: number) => {
    if (depth > 12 || node == null || out.length > 400) return;
    if (typeof node === "string") {
      if (!/^(?:https?:)?\/\//.test(node)) return;
      if (!IMAGE_URL_RE.test(node)) return;
      if (seen.has(node)) return;
      seen.add(node);
      out.push({ url: node, width: null });
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    if (typeof node !== "object") return;
    for (const value of Object.values(node)) walk(value, depth + 1);
  };

  walk(data, 0);
  return out;
}

/** `<img>` and `<source>`: the only places a width descriptor is declared. */
function fromMarkupTags(html: string): Candidate[] {
  const out: Candidate[] = [];
  for (const tag of html.match(/<(?:img|source)\b[^>]*>/gi) ?? []) {
    const srcset =
      pick(tag, "srcset") ?? pick(tag, "data-srcset") ?? pick(tag, "data-lazy-srcset");
    if (srcset) {
      const best = largestFromSrcset(srcset);
      if (best) {
        out.push(best);
        continue;
      }
    }
    const src = pick(tag, "src") ?? pick(tag, "data-src") ?? pick(tag, "data-original");
    if (!src) continue;
    if (!IMAGE_URL_RE.test(src)) continue;
    const width = Number(pick(tag, "width") ?? "");
    out.push({ url: src, width: Number.isFinite(width) && width > 0 ? width : null });
  }
  return out;
}

/** Rule (d)'s backbone: every image URL in the page, with where it was found. */
function fromSweep(page: string): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const match of page.matchAll(SWEEP_RE)) {
    const url = match[0];
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ url, width: null, pos: match.index });
    if (out.length >= 600) break;
  }
  return out;
}

function pick(tag: string, name: string): string | null {
  const m =
    tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i")) ??
    tag.match(new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, "i"));
  const value = m?.[1]?.trim();
  return value ? value : null;
}

/** `a.jpg 320w, b.jpg 1024w` -> `b.jpg`. Ties fall back to source order. */
export function largestFromSrcset(srcset: string): Candidate | null {
  let best: Candidate | null = null;
  let bestScore = -1;
  for (const entry of srcset.split(",")) {
    const parts = entry.trim().split(/\s+/);
    const url = parts[0];
    if (!url || url.startsWith("data:")) continue;
    const descriptor = parts[1] ?? "";
    const w = descriptor.match(/^(\d+(?:\.\d+)?)([wx])$/);
    // `2x` is a density, not a width — score it so the biggest still wins.
    const score = w ? (w[2] === "w" ? Number(w[1]) : Number(w[1]) * 1000) : 0;
    if (score > bestScore) {
      bestScore = score;
      best = { url, width: w && w[2] === "w" ? Number(w[1]) : null };
    }
  }
  return best;
}

function safeParse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** Absolute http(s) only, and it has to look like a picture. */
function normalize(raw: string, base: string | null): string | null {
  let value = raw.trim().replace(/&amp;/g, "&");
  if (!value || value.startsWith("data:")) return null;
  if (value.startsWith("//")) value = `https:${value}`;
  if (!/^https?:\/\//i.test(value)) {
    if (!base) return null;
    try {
      value = new URL(value, base).toString();
    } catch {
      return null;
    }
  }
  const parsed = safeParse(value);
  if (!parsed) return null;
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (!IMAGE_PATH_RE.test(parsed.pathname)) return null; // rule (a)
  return parsed.toString();
}

/**
 * Which rendition to keep. Zillow's ladder is explicit — uncropped, then
 * `cc_ft_1536`, then the widest `cc_ft_N`, then the bare `-p_d` — and jpg wins
 * a tie with webp, because `sharp` and every mail client take jpg without
 * argument. Everything else is scored on whatever width it admits to.
 */
function variantScore(parsed: URL, width: number | null): number {
  const jpg = /\.jpe?g$/i.test(parsed.pathname) ? 1 : 0;
  const fp = parsed.pathname.match(ZILLOW_FP_RE);
  if (fp) {
    const variant = (fp[2] ?? "").toLowerCase();
    const uncropped = fp[3] ? Number(fp[3]) : null;
    const ccFt = fp[4] ? Number(fp[4]) : null;
    let score = 1_000;
    if (uncropped != null) score = 90_000 + uncropped;
    else if (ccFt === 1536) score = 80_000;
    else if (ccFt != null) score = 10_000 + ccFt;
    else if (variant.startsWith("p_")) score = 5_000;
    return score * 2 + jpg;
  }
  if (width != null) return (1_000 + width) * 2 + jpg;
  for (const [re, rank] of SIZE_WORDS) {
    if (re.test(parsed.pathname)) return rank * 2 + jpg;
  }
  return jpg;
}

/** A width the URL itself declares: `?width=200`, `-cc_ft_192`, `_640x480`. */
function widthHint(parsed: URL): number | null {
  for (const key of ["width", "w", "maxwidth"]) {
    const value = Number(parsed.searchParams.get(key) ?? "");
    if (Number.isFinite(value) && value > 0) return value;
  }
  // The optional trailing `c` is craigslist's crop marker: `_50x50c.jpg` is
  // the 50px square thumb of `_600x450.jpg`. Without it the thumb declared no
  // width at all, sailed past `MIN_WIDTH`, and was saved as a blurry twin.
  const suffix = parsed.pathname.match(
    /(?:-cc_ft_|uncropped_scaled_within_|[-_])(\d{2,4})(?:[x_]\d{2,4}c?)?\.(?:jpe?g|png|webp|avif|gif)$/i,
  );
  return suffix ? Number(suffix[1]) : null;
}

/**
 * All the renditions of one photo share a key. Zillow states it outright (the
 * hash in `/fp/<hash>-…`); elsewhere we strip the size out of the filename.
 */
function groupKey(parsed: URL): string {
  const host = parsed.hostname.toLowerCase();
  const fp = parsed.pathname.match(ZILLOW_FP_RE);
  if (fp) return `${host}/fp/${(fp[1] ?? "").toLowerCase()}`;
  const path = parsed.pathname
    .toLowerCase()
    .replace(/-cc_ft_\d+/g, "")
    .replace(
      /[-_](?:small|medium|large|xlarge|thumb|thumbnail|orig|\d{2,4}x\d{2,4}c?|\d{2,4}w)(?=\.|$)/g,
      "",
    );
  return `${host}${path}`;
}

/**
 * Where a candidate sits in the page. Anything the sweep did not literally
 * find (an entity-decoded meta URL, a relative `src`) sorts after everything
 * it did, in the order we collected it.
 */
function locate(page: string, raw: string, order: number): number {
  const at = page.indexOf(raw.trim());
  return at >= 0 ? at : page.length + 1 + order;
}
