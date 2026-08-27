import "server-only";

/**
 * The part of "save a photo" that has nothing to do with HTTP: fetch or read
 * the bytes, re-encode them with `sharp`, put two objects in the bucket, write
 * the rows, and leave one line in the feed.
 *
 * It lived inside `POST /api/photos` until `/api/photos/refresh` and the sync
 * run needed exactly the same thing — a second copy of the decode-bomb guard
 * and the object-rollback ordering is not something to maintain twice — so it
 * is here, and the route is now the thin part: auth, the body, the status code
 * for a request where nothing survived.
 *
 * Everything here is a limit. See the comments on each constant; the reasoning
 * is in CLAUDE.md → Photos.
 */

import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { UUID_RE } from "@/lib/api-auth";
import type { createAdminClient } from "@/lib/supabase/admin";
import { assertSafeUrl, BROWSER_HEADERS, UnsafeUrlError } from "@/lib/import/fetch-page";
import type { PhotoFailure } from "@/lib/photo-types";
import type { ListingPhoto, Uuid } from "@/lib/types";

export type Admin = ReturnType<typeof createAdminClient>;

export const BUCKET = "listing-photos";

/** Matches the bucket's own `file_size_limit` (0007). */
const MAX_BYTES = 8 * 1024 * 1024;
/** A CDN that has not answered in six seconds is not going to. */
const IMAGE_TIMEOUT_MS = 6_000;
const MAX_REDIRECTS = 3;
/** One import caps at 12; a camera-roll multi-select can be greedier. */
export const MAX_PER_REQUEST = 24;
export const CONCURRENCY = 4;

/** Main image: big enough for a phone lightbox, small enough to be free. */
const MAIN_EDGE = 1280;
const MAIN_QUALITY = 80;
const THUMB_EDGE = 400;
const THUMB_QUALITY = 70;

/**
 * A 40-megapixel ceiling on the *decoded* image, which is the number that
 * decides how much memory sharp asks for — 8MB of bytes is not 8MB of pixels,
 * and a 500KB webp declaring 60,000 x 60,000 is a decode bomb that takes the
 * whole function down with an OOM rather than failing one photo. Real camera
 * output tops out around 50MP on a medium-format back; a phone is 12-48MP.
 */
const MAX_PIXELS = 40_000_000;

export const HEIC_MESSAGE = "Export as JPEG first";
export const TOO_BIG_MESSAGE = "That photo is bigger than 8MB.";
const HUGE_MESSAGE = "That image is too large to process.";
const UNREADABLE_MESSAGE = "Couldn't read that image.";

/**
 * Why one image did not make it. `kind` picks the status when *all* of them
 * fail; the `Failure` itself is the client's shape, from `photo-types.ts`.
 */
export type FailKind = "unsafe" | "heic" | "too_big" | "other";
type Failure = PhotoFailure;
export type Attempt = { failure: Failure; kind: FailKind };

/** One image, decoded and re-encoded, waiting for a row. */
type Encoded = {
  main: Buffer;
  thumb: Buffer;
  width: number;
  height: number;
  bytes: number;
  sourceUrl: string | null;
};

export type StorePhotosInput = {
  admin: Admin;
  listingId: string;
  /** URLs (copied from a listing site) and/or files (a camera roll). */
  items: (string | File)[];
  /** The listing page's origin. Zillow's image CDN 403s a bare request. */
  referer: string | null;
  /** `listing_photos.added_by`: who to credit for the row, or nobody. */
  addedBy: Uuid | null;
  /** `activity.person_id`: who signs the feed line. Null skips the line. */
  actorId: Uuid | null;
  /** How the feed line reads. Defaults to the manual/import phrasing. */
  summary?: (count: number, label: string) => string;
  /** The listing, as a person reads it ("214 Grand St #4B"). */
  label: string;
};

export type StorePhotosResult = {
  photos: ListingPhoto[];
  attempts: Attempt[];
  /** Set when the rows could not be written at all — nothing survived. */
  fatal?: string;
};

/**
 * Encode, upload, insert, log. A photo that fails is an `Attempt`, not a
 * throw: one CDN 403 out of nine must not lose the eight that worked.
 */
export async function storePhotos({
  admin,
  listingId,
  items,
  referer,
  addedBy,
  actorId,
  label,
  summary = defaultSummary,
}: StorePhotosInput): Promise<StorePhotosResult> {
  const encoded = await pool<string | File, Encoded | Attempt>(
    items,
    CONCURRENCY,
    (item) => (typeof item === "string" ? encodeFromUrl(item, referer) : encodeFromFile(item)),
  );

  const ready: Encoded[] = [];
  const attempts: Attempt[] = [];
  for (const result of encoded) {
    if ("failure" in result) attempts.push(result);
    else ready.push(result);
  }

  // --- upload, then insert. Objects first: a row pointing at nothing would
  // render as a broken tile forever, an orphaned object is invisible.
  const uploaded: (Encoded & { storagePath: string; thumbPath: string })[] = [];
  for (const item of ready) {
    const key = `${listingId}/${randomUUID()}`;
    const storagePath = `${key}.webp`;
    const thumbPath = `${key}_thumb.webp`;

    const mainUp = await admin.storage
      .from(BUCKET)
      .upload(storagePath, item.main, { contentType: "image/webp", upsert: false });
    if (mainUp.error) {
      console.error("[photos] upload failed", mainUp.error.message);
      attempts.push({
        failure: { url: item.sourceUrl ?? undefined, reason: "Couldn't store that photo." },
        kind: "other",
      });
      continue;
    }
    const thumbUp = await admin.storage
      .from(BUCKET)
      .upload(thumbPath, item.thumb, { contentType: "image/webp", upsert: false });
    if (thumbUp.error) {
      console.error("[photos] thumb upload failed", thumbUp.error.message);
      await admin.storage.from(BUCKET).remove([storagePath]);
      attempts.push({
        failure: { url: item.sourceUrl ?? undefined, reason: "Couldn't store that photo." },
        kind: "other",
      });
      continue;
    }
    uploaded.push({ ...item, storagePath, thumbPath });
  }

  let photos: ListingPhoto[] = [];
  if (uploaded.length > 0) {
    const base = await nextSort(admin, listingId);
    const { data, error } = await admin
      .from("listing_photos")
      .insert(
        uploaded.map((item, i) => ({
          listing_id: listingId,
          storage_path: item.storagePath,
          thumb_path: item.thumbPath,
          source_url: item.sourceUrl,
          width: item.width,
          height: item.height,
          bytes: item.bytes,
          sort: base + i,
          added_by: addedBy,
        })),
      )
      .select("*");
    if (error) {
      // The rows are what make an object visible; without them the upload was
      // pointless, so take the objects back out rather than leak them.
      console.error("[photos] insert failed", error);
      await admin.storage
        .from(BUCKET)
        .remove(uploaded.flatMap((i) => [i.storagePath, i.thumbPath]));
      return { photos: [], attempts, fatal: "Couldn't save those photos." };
    }
    photos = (data ?? []) as ListingPhoto[];
  }

  // One line per batch, not per photo: "added 8 photos to 214 Grand St #4B" is
  // an impression; eight identical rows are a log file.
  if (photos.length > 0 && actorId) {
    const { error } = await admin.from("activity").insert({
      person_id: actorId,
      verb: "added_photos",
      entity_type: "listing",
      entity_id: listingId,
      summary: summary(photos.length, label),
    });
    if (error) console.error("[photos] activity insert failed", error);
  }

  return { photos, attempts };
}

function defaultSummary(count: number, label: string): string {
  return `added ${count} ${count === 1 ? "photo" : "photos"} to ${label}`;
}

// -- encoding -----------------------------------------------------------------

/**
 * Fetch one image and re-encode it. Every rung is a limit: the SSRF guard on
 * every hop (a CDN redirect is still an outbound request we chose to make), six
 * seconds, `image/*` only, 8MB read as it streams rather than trusted from
 * `content-length`.
 */
export async function encodeFromUrl(
  raw: string,
  referer: string | null,
): Promise<Encoded | Attempt> {
  let current = raw;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let url: URL;
    try {
      url = await assertSafeUrl(current);
    } catch (error) {
      return {
        kind: "unsafe",
        failure: {
          url: raw,
          reason:
            error instanceof UnsafeUrlError ? error.message : "That link can't be fetched.",
        },
      };
    }

    let res: Response;
    try {
      res = await fetch(url, {
        redirect: "manual",
        headers: {
          ...BROWSER_HEADERS,
          Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
          ...(referer ? { Referer: referer } : {}),
        },
        signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
        cache: "no-store",
      });
    } catch {
      return { kind: "other", failure: { url: raw, reason: "Couldn't fetch that photo." } };
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      await res.body?.cancel().catch(() => {});
      if (!location) {
        return { kind: "other", failure: { url: raw, reason: "That photo redirected nowhere." } };
      }
      try {
        current = new URL(location, url).toString();
      } catch {
        return {
          kind: "other",
          failure: { url: raw, reason: "That photo redirected somewhere odd." },
        };
      }
      continue;
    }

    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return {
        kind: "other",
        failure: { url: raw, reason: `The host said ${res.status}.` },
      };
    }

    const type = res.headers.get("content-type") ?? "";
    if (type && !/^image\//i.test(type.trim())) {
      await res.body?.cancel().catch(() => {});
      return { kind: "other", failure: { url: raw, reason: "That link isn't an image." } };
    }
    if (/hei[cf]/i.test(type)) {
      await res.body?.cancel().catch(() => {});
      return { kind: "heic", failure: { url: raw, reason: HEIC_MESSAGE } };
    }

    const body = await readCapped(res);
    if (body.kind === "too_big") {
      return { kind: "too_big", failure: { url: raw, reason: TOO_BIG_MESSAGE } };
    }
    if (body.kind === "empty") {
      // Not too big and not our fault — a 200 with no bytes. A 413 here would
      // tell the client to send fewer photos, which would not help at all.
      return { kind: "other", failure: { url: raw, reason: "That photo came back empty." } };
    }
    if (body.kind === "network") {
      console.error("[photos] read failed", { url: raw, reason: body.reason });
      return { kind: "other", failure: { url: raw, reason: "Couldn't fetch that photo." } };
    }
    return encode(body.buffer, raw);
  }

  return { kind: "other", failure: { url: raw, reason: "That photo redirected too many times." } };
}

/** A file off a phone. Size and HEIC are decided before anything is read. */
export async function encodeFromFile(file: File): Promise<Encoded | Attempt> {
  const name = file.name || "photo";
  // iOS hands over HEIC when the camera is set to "High Efficiency" and the
  // picker is not asked to convert. `sharp` on Vercel has no libheif, so this
  // is a sentence rather than a decode error nobody can act on.
  if (/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(name)) {
    return { kind: "heic", failure: { name, reason: HEIC_MESSAGE } };
  }
  if (file.size > MAX_BYTES) {
    return { kind: "too_big", failure: { name, reason: TOO_BIG_MESSAGE } };
  }
  if (file.type && !/^image\//i.test(file.type)) {
    return { kind: "other", failure: { name, reason: "That isn't an image." } };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.byteLength > MAX_BYTES) {
    return { kind: "too_big", failure: { name, reason: TOO_BIG_MESSAGE } };
  }
  const result = await encode(buffer, null);
  if ("failure" in result && !result.failure.name) result.failure.name = name;
  return result;
}

/**
 * The one re-encode. `rotate()` with no argument bakes in EXIF orientation —
 * without it a phone's portrait photo lands sideways — and sharp writes no
 * metadata unless asked, so the GPS coordinates of someone's apartment tour do
 * not go into a public bucket.
 */
async function encode(input: Buffer, sourceUrl: string | null): Promise<Encoded | Attempt> {
  const fail = (reason: string): Attempt => ({
    kind: "other",
    failure: { url: sourceUrl ?? undefined, reason },
  });
  try {
    const pipeline = sharp(input, {
      // `failOn: "none"` swallowed a truncated file *and* uncapped the decode:
      // `limitInputPixels` defaults to 0x3FFF_FFFF but only when sharp's own
      // options are left alone, and a header claiming 60,000 x 60,000 is an
      // out-of-memory crash for the whole function, not one bad photo.
      failOn: "truncated",
      limitInputPixels: MAX_PIXELS,
      sequentialRead: true,
    }).rotate();

    // Headers first: the dimensions decide whether we decode at all.
    const meta = await pipeline.metadata();
    if (!meta.format) return fail(UNREADABLE_MESSAGE);
    const pixels = (meta.width ?? 0) * (meta.height ?? 0);
    if (pixels > MAX_PIXELS) return fail(HUGE_MESSAGE);

    // One decode of the original, straight to the 1280px webp; the thumbnail
    // is then a decode of *that* (a 1280px webp, ~100KB) rather than a second
    // pass over a 40MP JPEG. `rotate()` is already baked into `main`, so the
    // thumbnail must not rotate again.
    const main = await pipeline
      .resize({ width: MAIN_EDGE, height: MAIN_EDGE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: MAIN_QUALITY })
      .toBuffer({ resolveWithObject: true });
    const thumb = await sharp(main.data, { limitInputPixels: MAX_PIXELS })
      .resize({ width: THUMB_EDGE, height: THUMB_EDGE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: THUMB_QUALITY })
      .toBuffer();

    return {
      main: main.data,
      thumb,
      width: main.info.width,
      height: main.info.height,
      bytes: main.data.byteLength,
      sourceUrl,
    };
  } catch (error) {
    // libvips enforces `limitInputPixels` inside `metadata()` itself, so the
    // bomb usually arrives here as a throw rather than as dimensions we get to
    // measure — the explicit check above is the belt to this pair of braces.
    // Either way the person who picked the file gets the same sentence.
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[photos] encode failed", error);
    if (/pixel limit/i.test(detail)) return fail(HUGE_MESSAGE);
    if (/unsupported image format/i.test(detail)) return fail(UNREADABLE_MESSAGE);
    return fail("That image wouldn't open.");
  }
}

/**
 * Read the body, giving up at the cap instead of trusting `content-length`.
 *
 * Three ways to come back with no buffer and they are not the same thing: a
 * file over the cap (the client's problem, 413), an empty 200 (the host's
 * problem) and a socket that died mid-read (nobody's problem, retryable). One
 * `null` for all three used to report every one of them as "bigger than 8MB",
 * which is a lie in two cases out of three and the wrong status code.
 */
type ReadResult =
  | { kind: "ok"; buffer: Buffer }
  | { kind: "too_big" }
  | { kind: "empty" }
  | { kind: "network"; reason: string };

async function readCapped(res: Response): Promise<ReadResult> {
  const reader = res.body?.getReader();
  if (!reader) return { kind: "empty" };
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel().catch(() => {});
        return { kind: "too_big" };
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    return {
      kind: "network",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  return chunks.length > 0
    ? { kind: "ok", buffer: Buffer.concat(chunks) }
    : { kind: "empty" };
}

// -- people -------------------------------------------------------------------

/**
 * `personId` if it names one of *us*, else null (the feed line is skipped).
 *
 * Quest Bot is a person row (0006) because `activity.person_id` is NOT NULL,
 * not because it has a camera roll. It signs listing-state changes and nothing
 * else, so a request naming it — a copy-pasted id, a future automation — gets
 * an unsigned batch rather than "Quest Bot added 8 photos". The bot's own
 * re-sync goes through `botPersonId` below and knows what it is doing.
 */
export async function resolvePerson(
  admin: Admin,
  personId: string | null,
): Promise<Uuid | null> {
  if (!personId || !UUID_RE.test(personId)) return null;
  const { data } = await admin
    .from("people")
    .select("id, key")
    .eq("id", personId)
    .maybeSingle();
  if (!data || data.key === "bot") return null;
  return (data.id as Uuid | undefined) ?? null;
}

/** `activity.person_id` is NOT NULL; Quest Bot is the row 0006 inserts. */
export async function botPersonId(admin: Admin): Promise<Uuid | null> {
  const { data, error } = await admin
    .from("people")
    .select("id")
    .eq("key", "bot")
    .maybeSingle();
  if (error) {
    console.error("[photos] bot lookup failed", error);
    return null;
  }
  // No bot row means 0006 has not been applied here. The work still happens;
  // only the feed line is skipped.
  if (!data) console.error("[photos] no 'bot' person — apply 0006_listing_sync.sql");
  return (data?.id as Uuid | undefined) ?? null;
}

// -- helpers ------------------------------------------------------------------

/** Append after whatever is already there, so an import keeps page order. */
async function nextSort(admin: Admin, listingId: string): Promise<number> {
  const { data } = await admin
    .from("listing_photos")
    .select("sort")
    .eq("listing_id", listingId)
    .order("sort", { ascending: false })
    .limit(1)
    .maybeSingle();
  const max = typeof data?.sort === "number" ? data.sort : -1;
  return max + 1;
}

/** The listing page's origin, which is the `Referer` its image CDN expects. */
export function originOf(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? `${parsed.origin}/`
      : null;
  } catch {
    return null;
  }
}

/** Smallest possible worker pool: `size` runners off one shared cursor. */
export async function pool<In, Out>(
  items: In[],
  size: number,
  run: (item: In) => Promise<Out>,
): Promise<Out[]> {
  const out = new Array<Out>(items.length);
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await run(items[i] as In);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}
