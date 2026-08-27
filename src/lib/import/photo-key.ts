/**
 * One photo, one key — the identity a re-sync compares against.
 *
 * A listing site adds pictures after we imported it, so `/api/photos/refresh`
 * has to answer "have we already got this one?" without a column to look it up
 * in. The only thing we stored is `listing_photos.source_url`, and the URL we
 * saved a fortnight ago is rarely the string the page is serving today: Zillow
 * publishes seventeen renditions of every picture and rotates which one the
 * markup names, and StreetEasy's CDN hangs `-large` / `-medium` / `_1024x768`
 * off the same filename. Compared raw, every one of those is "new", and a
 * refresh would re-upload the whole gallery twice a week.
 *
 * So the comparison is on a *derived* key, computed at compare time on both
 * sides. Nothing is stored: a stored key is a column that goes stale the day
 * the rule changes, and this rule will change the next time a site does.
 *
 *  - **Zillow** states the identity outright — `/fp/<hash>-<variant>.<ext>` —
 *    so the hash is the whole key and the variant is thrown away.
 *  - **StreetEasy and CloudFront** put the identity in the filename and the
 *    size beside it, so the key is the host and the filename with the size
 *    suffix stripped. The directory is deliberately not in it: the same image
 *    moves between path prefixes and the filenames are ids, not `photo1.jpg`.
 *  - **Everything else** is host + path, lower-cased, with the query gone. A
 *    signed or cache-busted query string is not a different photo.
 *
 * Pure and tested (`photo-key.test.ts`). A manual upload has a null
 * `source_url` and therefore no key at all — it came off somebody's phone, it
 * is not a rendition of anything, and it can never make a page's photo look
 * like a duplicate.
 */

/** Any Zillow media host; the `/fp/` path is what actually has to match. */
const ZILLOW_HOST_RE = /(?:^|\.)zillowstatic\.com$/i;

/**
 * `/fp/<hash>-<variant>.<ext>`. The variant list is the same one
 * `discoverPhotos` ranks renditions with (`photos.ts`); an unrecognised suffix
 * stays part of the hash rather than being guessed away.
 */
const ZILLOW_FP_RE =
  /^\/fp\/(.+?)(?:-(?:uncropped_scaled_within_\d+_\d+|cc_ft_\d+|p_[a-z]))?\.(?:jpe?g|png|webp|avif|gif)$/i;

/** Hosts whose renditions differ only in the filename's size suffix. */
const FILENAME_HOST_RE = /(?:^|\.)(?:streeteasy\.com|cloudfront\.net)$/i;

/** `-large`, `_1024x768`, `-w800`, `-cc_ft_384` — a size, not a picture. */
const SIZE_SUFFIX_RE =
  /(?:[-_](?:x?x?large|medium|small|thumb(?:nail)?|tiny|orig(?:inal)?|full)|[-_]\d{2,4}x\d{2,4}|[-_]w\d{2,4}|[-_]cc_ft_\d+)$/i;

const EXTENSION_RE = /\.(?:jpe?g|png|webp|avif|gif)$/i;

/**
 * The key two photos share when they are the same photo, or `null` for
 * anything that is not a comparable URL — an empty string, a manual upload's
 * absent `source_url`, a `data:` URI, something that will not parse.
 */
export function photoSourceKey(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  let value = raw.trim();
  if (!value) return null;
  // Protocol-relative is the same picture as the https one beside it.
  if (value.startsWith("//")) value = `https:${value}`;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const host = url.hostname.toLowerCase();
  const path = decodePath(url.pathname);

  if (ZILLOW_HOST_RE.test(host)) {
    const hash = path.match(ZILLOW_FP_RE)?.[1];
    if (hash) return `zillow:${hash.toLowerCase()}`;
  }

  if (FILENAME_HOST_RE.test(host)) {
    const name = stripSize(path.slice(path.lastIndexOf("/") + 1).toLowerCase());
    if (name) return `${host}:${name}`;
  }

  // The query is never identity: `?w=640`, `?auto=webp`, an expiring
  // signature and a cache-buster are all the same bytes on the same host.
  return `${host}${path.toLowerCase()}`;
}

/** The filename without its extension and without the size hung off the end. */
function stripSize(filename: string): string {
  let name = filename.replace(EXTENSION_RE, "");
  // Sites stack them (`-large_1024x768`), so strip until nothing more comes off.
  for (let i = 0; i < 4; i++) {
    const next = name.replace(SIZE_SUFFIX_RE, "");
    if (next === name) break;
    name = next;
  }
  return name;
}

/**
 * `%2F` and a literal `/` are the same path. `decodeURIComponent` throws on a
 * lone `%`, which is a URL we simply compare as it arrived.
 */
function decodePath(pathname: string): string {
  try {
    return decodeURI(pathname);
  } catch {
    return pathname;
  }
}
