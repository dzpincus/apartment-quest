/**
 * Photo discovery. Pure: HTML in, a short ordered list of image URLs out. The
 * route hands the list to the panel, the user unticks the junk, Part 3 copies
 * what survives into Supabase Storage.
 *
 * The hard part is not finding images — a listing page has two hundred — it is
 * finding the *eight* that are the apartment. Three rules do most of the work:
 * only accept image-looking URLs from the places listings actually put them,
 * always take the largest variant offered, and drop anything whose path calls
 * itself a logo/icon/map/pixel.
 */

import { extractMeta, extractNextData, type JsonValue } from "./reduce";

/** The panel shows a 4-wide grid; three rows is plenty to pick from. */
export const PHOTO_CAP = 12;

/** Below this a "photo" is a sprite, a badge or a tracking pixel. */
const MIN_WIDTH = 300;

const IMAGE_EXT_RE = /\.(?:jpe?g|png|webp)(?:$|\?|#)/i;

/** Hosts that only ever serve listing media. */
const CDN_HOST_RE =
  /(?:^|\.)(?:zillowstatic\.com|streeteasy\.com|cloudfront\.net|cloudinary\.com|imgix\.net)$|^(?:images?|img|media|photos?|cdn)\./i;

const JUNK_RE =
  /logo|icon|avatar|map|sprite|pixel|badge|placeholder|blank|spacer|favicon|watermark|1x1/i;

/** Zillow encodes the rendition in the filename; ask for the big one. */
const ZILLOW_SIZE_RE = /-cc_ft_\d+(\.(?:jpe?g|png|webp))/i;

type Candidate = { url: string; width: number | null };

export function discoverPhotos(
  html: string,
  opts: { cap?: number; baseUrl?: string | null } = {},
): string[] {
  const cap = opts.cap ?? PHOTO_CAP;
  const base = opts.baseUrl ?? null;

  const candidates: Candidate[] = [
    ...fromMeta(html),
    ...fromJsonLd(html),
    ...fromNextData(html),
    ...fromImgTags(html),
  ];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const candidate of candidates) {
    const url = normalize(candidate.url, base);
    if (!url) continue;
    if (candidate.width != null && candidate.width < MIN_WIDTH) continue;
    const parsed = safeParse(url);
    if (!parsed) continue;
    if (JUNK_RE.test(parsed.pathname)) continue;
    const width = candidate.width ?? widthHint(parsed);
    if (width != null && width < MIN_WIDTH) continue;
    const key = dedupeKeyFor(parsed);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);
    if (out.length >= cap) break;
  }
  return out;
}

/** `og:image` is the one image a page explicitly claims is *the* image. */
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
 * Zillow's photo array lives in `__NEXT_DATA__` and nowhere else in the
 * markup, so the string sweep is the only way to reach it. Only strings that
 * already look like images or come from a media CDN qualify — everything else
 * in that blob is analytics.
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
      if (!IMAGE_EXT_RE.test(node) && !hostIsCdn(node)) return;
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

function fromImgTags(html: string): Candidate[] {
  const out: Candidate[] = [];
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
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
    if (!IMAGE_EXT_RE.test(src) && !hostIsCdn(src)) continue;
    const width = Number(pick(tag, "width") ?? "");
    out.push({ url: src, width: Number.isFinite(width) && width > 0 ? width : null });
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

function hostIsCdn(raw: string): boolean {
  const parsed = safeParse(raw.startsWith("//") ? `https:${raw}` : raw);
  return parsed ? CDN_HOST_RE.test(parsed.hostname) : false;
}

function safeParse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** Absolute http(s) only, upscaled where the host encodes a size. */
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
  if (!IMAGE_EXT_RE.test(parsed.pathname) && !CDN_HOST_RE.test(parsed.hostname)) {
    return null;
  }
  return upscale(parsed.toString());
}

function upscale(url: string): string {
  return url.replace(ZILLOW_SIZE_RE, "-cc_ft_1536$1");
}

/** A width the URL itself declares: `?width=200`, `-cc_ft_192`, `_640x480`. */
function widthHint(parsed: URL): number | null {
  for (const key of ["width", "w", "maxwidth"]) {
    const value = Number(parsed.searchParams.get(key) ?? "");
    if (Number.isFinite(value) && value > 0) return value;
  }
  const suffix = parsed.pathname.match(/(?:-cc_ft_|[-_])(\d{2,4})(?:x\d{2,4})?\.(?:jpe?g|png|webp)$/i);
  return suffix ? Number(suffix[1]) : null;
}

function dedupeKeyFor(parsed: URL): string {
  const path = parsed.pathname
    .toLowerCase()
    .replace(/-cc_ft_\d+/g, "")
    .replace(/[-_](?:small|medium|large|xlarge|thumb|thumbnail|orig|\d{2,4}x\d{2,4}|\d{2,4}w)(?=\.|$)/g, "");
  return `${parsed.hostname.toLowerCase()}${path}`;
}
