import "server-only";

/**
 * `POST /api/photos` — put pictures of an apartment somewhere permanent.
 *
 *   { listingId, personId, urls[] }      the import path: copy from the CDN
 *   multipart/form-data with files       the manual path: a phone camera roll
 *
 * `DELETE /api/photos` with `{ photoId }` removes both objects and the row.
 *
 * Why a route rather than the client's own supabase-js: `sharp` runs here, so
 * every stored image is a stripped, auto-oriented webp with a thumbnail beside
 * it no matter which door it came in through, and the storage paths are decided
 * in one place. The storage policies still allow an authenticated client to
 * write directly (0007) — that is a backstop, not a second code path.
 *
 * Failure is expected and is not an error. A CDN that 403s our server, one
 * photo out of nine that decodes to nothing, a file the phone mislabelled: each
 * is an entry in `failed` beside the photos that did save. The request only
 * takes a non-200 when *nothing* worked and the reason is worth a status code
 * (401/404 for the obvious ones, 413 too big, 415 HEIC, 400 unsafe URL).
 */

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { createClient } from "@/lib/supabase/server";
import { UUID_RE } from "@/lib/api-auth";
import { createAdminClient, MissingServiceRoleKeyError } from "@/lib/supabase/admin";
import { listingLabel } from "@/lib/format";
import { assertSafeUrl, BROWSER_HEADERS, UnsafeUrlError } from "@/lib/import/fetch-page";
import {
  BATCH_TOO_BIG_MESSAGE,
  MULTIPART_MAX_BYTES,
  type PhotoFailure,
  type SavePhotosResponse,
} from "@/lib/photo-types";
import type { ListingPhoto, Uuid } from "@/lib/types";

export const runtime = "nodejs";
/** Twelve images, fetched and re-encoded four at a time. 10s is not enough. */
export const maxDuration = 60;

export const BUCKET = "listing-photos";

/** Matches the bucket's own `file_size_limit` (0007). */
const MAX_BYTES = 8 * 1024 * 1024;
/** A CDN that has not answered in six seconds is not going to. */
const IMAGE_TIMEOUT_MS = 6_000;
const MAX_REDIRECTS = 3;
/** One import caps at 12; a camera-roll multi-select can be greedier. */
const MAX_PER_REQUEST = 24;
const CONCURRENCY = 4;

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

const HEIC_MESSAGE = "Export as JPEG first";
const TOO_BIG_MESSAGE = "That photo is bigger than 8MB.";
const HUGE_MESSAGE = "That image is too large to process.";
const UNREADABLE_MESSAGE = "Couldn't read that image.";

/**
 * Why one image did not make it. `kind` picks the status when *all* of them
 * fail; the `Failure` itself is the client's shape, from `photo-types.ts`.
 */
type FailKind = "unsafe" | "heic" | "too_big" | "other";
type Failure = PhotoFailure;
type Attempt = { failure: Failure; kind: FailKind };

/** One image, decoded and re-encoded, waiting for a row. */
type Encoded = {
  main: Buffer;
  thumb: Buffer;
  width: number;
  height: number;
  bytes: number;
  sourceUrl: string | null;
};

// -- POST ---------------------------------------------------------------------

export async function POST(request: Request): Promise<NextResponse<SavePhotosResponse>> {
  const started = Date.now();

  const session = await requireSession();
  if (!session.ok) return session.response;

  let admin;
  try {
    admin = createAdminClient();
  } catch (error) {
    const message =
      error instanceof MissingServiceRoleKeyError
        ? error.message
        : "Storage isn't configured on this deployment.";
    return json({ photos: [], failed: [], error: message }, 500);
  }

  // --- input: JSON urls or multipart files, never both.
  let listingId = "";
  let personId: string | null = null;
  let urls: string[] = [];
  let files: File[] = [];

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    // Before `formData()`, which buffers the whole body: twenty-four 8MB files
    // is 192MB of request, and Vercel's own limit is 4.5MB anyway. A declared
    // length over that is a sentence the client can act on rather than a
    // platform 413 with an HTML body and a JSON parse error behind it.
    const declared = Number(request.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > MULTIPART_MAX_BYTES) {
      return json({ photos: [], failed: [], error: BATCH_TOO_BIG_MESSAGE }, 413);
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return json({ photos: [], failed: [], error: "Couldn't read the upload." }, 400);
    }
    listingId = str(form.get("listingId"));
    personId = str(form.get("personId")) || null;
    files = form
      .getAll("files")
      .concat(form.getAll("file"))
      .filter((value): value is File => value instanceof File && value.size > 0);
  } else {
    let body: { listingId?: unknown; personId?: unknown; urls?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ photos: [], failed: [], error: "Expected a JSON body." }, 400);
    }
    listingId = typeof body.listingId === "string" ? body.listingId : "";
    personId = typeof body.personId === "string" ? body.personId : null;
    urls = Array.isArray(body.urls)
      ? body.urls.filter((u): u is string => typeof u === "string" && u.trim() !== "")
      : [];
  }

  if (!UUID_RE.test(listingId)) {
    return json({ photos: [], failed: [], error: "Which listing?" }, 400);
  }
  if (urls.length === 0 && files.length === 0) {
    return json({ photos: [], failed: [], error: "No photos in that request." }, 400);
  }

  // The service-role client bypasses RLS, so the row it is about to write must
  // be attached to a listing that actually exists — and the label for the
  // activity line comes from the same read.
  const { data: listing, error: listingError } = await admin
    .from("listings")
    .select("id, address, unit, url")
    .eq("id", listingId)
    .maybeSingle();
  if (listingError) {
    console.error("[photos] listing lookup failed", listingError);
    return json({ photos: [], failed: [], error: "Couldn't check that listing." }, 500);
  }
  if (!listing) {
    return json({ photos: [], failed: [], error: "That listing is gone." }, 404);
  }

  // `activity.person_id` is NOT NULL and points at `people`. An id that is not
  // one of us costs the feed entry, not the photos.
  const actorId = await resolvePerson(admin, personId);

  const overflow: Attempt[] = [];
  if (urls.length > MAX_PER_REQUEST) {
    for (const url of urls.slice(MAX_PER_REQUEST)) {
      overflow.push({ failure: { url, reason: "Too many photos at once." }, kind: "other" });
    }
    urls = urls.slice(0, MAX_PER_REQUEST);
  }
  if (files.length > MAX_PER_REQUEST) {
    for (const file of files.slice(MAX_PER_REQUEST)) {
      overflow.push({
        failure: { name: file.name, reason: "Too many photos at once." },
        kind: "other",
      });
    }
    files = files.slice(0, MAX_PER_REQUEST);
  }

  // The Referer a listing CDN wants is its own listing page — Zillow's image
  // hosts 403 a bare request. `listing.url` is the page these photos came from.
  const referer = originOf(listing.url as string | null);

  const encoded = await pool<string | File, Encoded | Attempt>(
    [...urls, ...files],
    CONCURRENCY,
    (item) =>
      typeof item === "string" ? encodeFromUrl(item, referer) : encodeFromFile(item),
  );

  const ready: Encoded[] = [];
  const attempts: Attempt[] = [...overflow];
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
          added_by: actorId,
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
      return json(
        {
          photos: [],
          failed: [...attempts.map((a) => a.failure)],
          error: "Couldn't save those photos.",
        },
        500,
      );
    }
    photos = (data ?? []) as ListingPhoto[];
  }

  // One line per batch, not per photo: "added 8 photos to 214 Grand St #4B" is
  // an impression; eight identical rows are a log file.
  if (photos.length > 0 && actorId) {
    const label = listingLabel(
      listing.address as string,
      listing.unit as string | null,
    );
    const { error } = await admin.from("activity").insert({
      person_id: actorId,
      verb: "added_photos",
      entity_type: "listing",
      entity_id: listingId,
      summary: `added ${photos.length} ${photos.length === 1 ? "photo" : "photos"} to ${label}`,
    });
    if (error) console.error("[photos] activity insert failed", error);
  }

  const failed = attempts.map((a) => a.failure);
  console.info("[photos] done", {
    listing: listingId,
    saved: photos.length,
    failed: failed.length,
    ms: Date.now() - started,
  });

  if (photos.length === 0 && attempts.length > 0) {
    const { status, message } = statusForFailures(attempts);
    return json({ photos, failed, error: message }, status);
  }
  return json({ photos, failed });
}

// -- DELETE -------------------------------------------------------------------

export async function DELETE(request: Request): Promise<NextResponse<{ ok?: true; error?: string }>> {
  const session = await requireSession();
  if (!session.ok) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  let admin;
  try {
    admin = createAdminClient();
  } catch (error) {
    const message =
      error instanceof MissingServiceRoleKeyError
        ? error.message
        : "Storage isn't configured on this deployment.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  let body: { photoId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  const photoId = typeof body.photoId === "string" ? body.photoId : "";
  if (!UUID_RE.test(photoId)) {
    return NextResponse.json({ error: "Which photo?" }, { status: 400 });
  }

  const { data: photo, error } = await admin
    .from("listing_photos")
    .select("id, storage_path, thumb_path")
    .eq("id", photoId)
    .maybeSingle();
  if (error) {
    console.error("[photos] delete lookup failed", error);
    return NextResponse.json({ error: "Couldn't find that photo." }, { status: 500 });
  }
  if (!photo) return NextResponse.json({ error: "That photo is already gone." }, { status: 404 });

  // Objects first, then the row: a failed object removal leaves a row pointing
  // at a live file (harmless, retryable), the other order leaves a tile that
  // 404s. `remove` is idempotent, so a re-run of a half-done delete is fine.
  const removed = await admin.storage
    .from(BUCKET)
    .remove([photo.storage_path as string, photo.thumb_path as string]);
  if (removed.error) console.error("[photos] object removal failed", removed.error.message);

  const { error: rowError } = await admin.from("listing_photos").delete().eq("id", photoId);
  if (rowError) {
    console.error("[photos] row delete failed", rowError);
    return NextResponse.json({ error: "Couldn't remove that photo." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

// -- encoding -----------------------------------------------------------------

/**
 * Fetch one image and re-encode it. Every rung is a limit: the SSRF guard on
 * every hop (a CDN redirect is still an outbound request we chose to make), six
 * seconds, `image/*` only, 8MB read as it streams rather than trusted from
 * `content-length`.
 */
async function encodeFromUrl(
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
        return { kind: "other", failure: { url: raw, reason: "That photo redirected somewhere odd." } };
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
async function encodeFromFile(file: File): Promise<Encoded | Attempt> {
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

// -- helpers ------------------------------------------------------------------

/** One shared login, but a signed-out request must not reach storage. */
async function requireSession(): Promise<
  { ok: true } | { ok: false; response: NextResponse<SavePhotosResponse> }
> {
  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return {
      ok: false,
      response: json({ photos: [], failed: [], error: "Supabase isn't configured." }, 500),
    };
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      response: json({ photos: [], failed: [], error: "Sign in first." }, 401),
    };
  }
  return { ok: true };
}

/**
 * `personId` if it names one of *us*, else null (the feed line is skipped).
 *
 * Quest Bot is a person row (0006) because `activity.person_id` is NOT NULL,
 * not because it has a camera roll. It signs listing-state changes and nothing
 * else, so a request naming it — a copy-pasted id, a future automation — gets
 * an unsigned batch rather than "Quest Bot added 8 photos".
 */
async function resolvePerson(
  admin: ReturnType<typeof createAdminClient>,
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

/** Append after whatever is already there, so an import keeps page order. */
async function nextSort(
  admin: ReturnType<typeof createAdminClient>,
  listingId: string,
): Promise<number> {
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

/**
 * The status for a request where nothing saved. A mixed bag stays a 200 with a
 * `failed` list — only a request that failed for one reason gets that reason's
 * code, so the client can toast something specific.
 */
function statusForFailures(attempts: Attempt[]): { status: number; message: string } {
  const kinds = new Set(attempts.map((a) => a.kind));
  if (kinds.size === 1) {
    const [kind] = [...kinds];
    if (kind === "heic") return { status: 415, message: HEIC_MESSAGE };
    if (kind === "too_big") return { status: 413, message: TOO_BIG_MESSAGE };
    if (kind === "unsafe") {
      return { status: 400, message: attempts[0]?.failure.reason ?? "That link can't be fetched." };
    }
  }
  return { status: 200, message: "None of those photos could be saved." };
}

function originOf(url: string | null): string | null {
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

function str(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function json(body: SavePhotosResponse, status = 200): NextResponse<SavePhotosResponse> {
  return NextResponse.json(body, { status });
}

/** Smallest possible worker pool: `size` runners off one shared cursor. */
async function pool<In, Out>(
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
