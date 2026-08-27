/**
 * The URL a listing should be *stored* under, which is not always the one
 * somebody pasted.
 *
 * StreetEasy has two pages for the same apartment. `/building/<slug>/<unit>` is
 * the **unit** page — everything that has ever happened at that address, the
 * live listing on top and three dead ones underneath it in a price-history
 * table — and `/rental/<id>` is one listing, the thing we are actually
 * tracking. The unit page is what a share sheet hands you, and it is the page
 * whose history table talked `/api/sync` into declaring a live apartment gone.
 *
 * Storing the `/rental/<id>` URL when the page tells us which one is live is
 * cheaper than teaching every later reader about history tables: one listing,
 * one page, one status.
 *
 * Pure — no network, no DOM — so `canonical.test.ts` runs the same code the
 * import route does. It is a *rewrite on import only*: existing rows keep the
 * URL they were saved with, because changing them under people would break the
 * "already added this link" check on the very links most likely to be reshared.
 */

import { normalizeListingUrl } from "@/lib/url";

/** How much of the text around a link may vouch for (or against) it. */
const WINDOW = 300;

/** The status codes that mean "this listing is the one you can rent". */
const LIVE_RE = /\b(?:AVAILABLE|ACTIVE|IN_CONTRACT|PENDING)\b/;
/** …and the ones that mean it is over. Any of these near a link disqualifies it. */
const DEAD_RE =
  /\b(?:NO_LONGER_AVAILABLE|RENTED|OFF_MARKET|DELISTED|EXPIRED|TEMPORARILY_OFF_MARKET)\b/;

const RENTAL_PATH_RE = /^\/rental\/\d+$/;

/**
 * The stable per-listing URL for this page, or `url` unchanged.
 *
 * Two ways to find it, in order:
 *
 * 1. `<link rel="canonical">` already pointing at a `/rental/<id>`. The site
 *    said it; nothing to infer.
 * 2. Exactly one `/rental/<id>` on the page that has a live status beside it
 *    and a dead one beside none of its occurrences. "Exactly one" and "none of
 *    its occurrences" are both doing real work: the page that caused this has
 *    five rental links, every one of them a history row sitting next to both an
 *    `ACTIVE` (the day it was listed) and a `DELISTED` (the day it ended), and
 *    the *live* listing has no `/rental/` link on the page at all. Five
 *    candidates, all disqualified, no rewrite — which is the right answer.
 */
export function canonicalListingUrl(url: string, html: string): string {
  if (!isStreetEasyUnitPage(url) || !html) return url;

  const declared = canonicalLink(html);
  if (declared && isRentalUrl(declared)) return normalizeListingUrl(declared) || declared;

  const live = liveRentalPaths(html);
  if (live.length !== 1) return url;
  return `https://streeteasy.com${live[0]}`;
}

/** A StreetEasy page that is about a unit rather than about one listing. */
export function isStreetEasyUnitPage(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "streeteasy.com") return false;
  return !RENTAL_PATH_RE.test(parsed.pathname.replace(/\/+$/, ""));
}

function isRentalUrl(href: string): boolean {
  try {
    const parsed = new URL(href);
    return (
      parsed.hostname.toLowerCase().replace(/^www\./, "") === "streeteasy.com" &&
      RENTAL_PATH_RE.test(parsed.pathname.replace(/\/+$/, ""))
    );
  } catch {
    return false;
  }
}

function canonicalLink(html: string): string | null {
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (!/\brel\s*=\s*["']?canonical\b/i.test(tag)) continue;
    const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    if (href) return href;
  }
  return null;
}

/**
 * `/rental/<id>` paths whose every mention on the page sits near a live status
 * and near no dead one. Sorted, so "exactly one" is a decision and not a race.
 */
export function liveRentalPaths(html: string): string[] {
  const live = new Set<string>();
  const dead = new Set<string>();

  for (const match of html.matchAll(/\/rental\/(\d+)\b/g)) {
    const path = `/rental/${match[1]}`;
    const from = Math.max(0, match.index - WINDOW);
    const to = match.index + match[0].length + WINDOW;
    const context = html.slice(from, to);
    if (DEAD_RE.test(context)) dead.add(path);
    else if (LIVE_RE.test(context)) live.add(path);
  }

  return [...live].filter((path) => !dead.has(path)).sort();
}
