import "server-only";

/**
 * `POST /api/photos` — put pictures of an apartment somewhere permanent.
 *
 *   { listingId, personId, urls[] }      the import path: copy from the CDN
 *   multipart/form-data with files       the manual path: a phone camera roll
 *
 * `DELETE /api/photos` with `{ photoId }` removes both objects and the row.
 * `POST /api/photos/refresh` is the third door: go back to the listing page
 * and pick up whatever it has added since (`src/lib/photos-sync.ts`).
 *
 * Why a route rather than the client's own supabase-js: `sharp` runs here, so
 * every stored image is a stripped, auto-oriented webp with a thumbnail beside
 * it no matter which door it came in through, and the storage paths are decided
 * in one place. The storage policies still allow an authenticated client to
 * write directly (0007) — that is a backstop, not a second code path.
 *
 * The work itself lives in `src/lib/photos-server.ts`, because the refresh
 * route and the sync run need every bit of it: the decode-bomb guard, the
 * object-then-row ordering, the rollback when the insert fails. What is left
 * here is the HTTP: who is asking, what they sent, and which status code a
 * request where nothing survived deserves.
 *
 * Failure is expected and is not an error. A CDN that 403s our server, one
 * photo out of nine that decodes to nothing, a file the phone mislabelled: each
 * is an entry in `failed` beside the photos that did save. The request only
 * takes a non-200 when *nothing* worked and the reason is worth a status code
 * (401/404 for the obvious ones, 413 too big, 415 HEIC, 400 unsafe URL).
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { UUID_RE } from "@/lib/api-auth";
import { createAdminClient, MissingServiceRoleKeyError } from "@/lib/supabase/admin";
import { listingLabel } from "@/lib/format";
import {
  type Attempt,
  BUCKET,
  HEIC_MESSAGE,
  MAX_PER_REQUEST,
  originOf,
  resolvePerson,
  storePhotos,
  TOO_BIG_MESSAGE,
} from "@/lib/photos-server";
import {
  BATCH_TOO_BIG_MESSAGE,
  MULTIPART_MAX_BYTES,
  type SavePhotosResponse,
} from "@/lib/photo-types";

export const runtime = "nodejs";
/** Twelve images, fetched and re-encoded four at a time. 10s is not enough. */
export const maxDuration = 60;

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

  const result = await storePhotos({
    admin,
    listingId,
    items: [...urls, ...files],
    // The Referer a listing CDN wants is its own listing page — Zillow's image
    // hosts 403 a bare request. `listing.url` is the page these photos came from.
    referer: originOf(listing.url as string | null),
    addedBy: actorId,
    actorId,
    label: listingLabel(listing.address as string, listing.unit as string | null),
  });

  const attempts = [...overflow, ...result.attempts];
  const failed = attempts.map((a) => a.failure);

  if (result.fatal) {
    return json({ photos: [], failed, error: result.fatal }, 500);
  }

  const photos = result.photos;
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

function str(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function json(body: SavePhotosResponse, status = 200): NextResponse<SavePhotosResponse> {
  return NextResponse.json(body, { status });
}
