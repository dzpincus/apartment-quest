/**
 * One listing page, one string.
 *
 * The same apartment reaches us as `https://StreetEasy.com/building/x/4b/`,
 * `https://streeteasy.com/building/x/4b?utm_source=email` and
 * `https://streeteasy.com/building/x/4b#photos`. All three are the same page,
 * and the import route's "someone already added this link" pre-check is an
 * `eq` on a text column, so without normalising, the second import of a link
 * shared over WhatsApp is a duplicate listing and a wasted model call.
 *
 * Pure, no `server-only`: the route uses it before the pre-check and
 * `coerce.ts` uses it when it puts the URL into the form, so what gets stored
 * is the same shape the next check compares against.
 *
 * What it does *not* do is validate. A string that is not a URL comes back
 * trimmed and untouched — `assertSafeUrl` is the gate, and it runs first.
 */

/** Campaign tags a share button bolted on. Never part of the page's identity. */
const TRACKING_PARAM = /^(?:utm_[a-z0-9_]*|fbclid|gclid)$/i;

export function normalizeListingUrl(raw: string | null | undefined): string {
  const input = (raw ?? "").trim();
  if (!input) return "";

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return input;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return input;

  // A fragment is a scroll position, never a different listing.
  url.hash = "";

  // `searchParams.delete` while iterating would skip entries; snapshot first.
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
  }

  // `URL` already lower-cases the host and drops a default port. The path
  // keeps its case (some sites route on it); only a trailing slash goes, so
  // `/x/4b/` and `/x/4b` stop being two listings.
  const query = url.searchParams.toString();
  const port = url.port ? `:${url.port}` : "";
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.protocol}//${url.hostname}${port}${path}${query ? `?${query}` : ""}`;
}
