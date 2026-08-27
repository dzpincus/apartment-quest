import "server-only";

/**
 * `POST /api/photos/refresh` — `{ listingId, personId? }`.
 *
 * Go back to the listing page and copy across whatever it has published since
 * we imported it, without adding a second copy of anything we already hold.
 * The work is `syncListingPhotos` (`src/lib/photos-sync.ts`); this is the
 * door, and it has two of them for the same reason `/api/geocode` does — the
 * **Refresh photos** button arrives with a session, and a terminal holding
 * `CRON_SECRET` can do the same thing without a browser:
 *
 * ```bash
 * curl -sS -X POST http://localhost:3000/api/photos/refresh \
 *   -H "Authorization: Bearer $CRON_SECRET" -H 'content-type: application/json' \
 *   -d '{"listingId":"<uuid>"}' | jq
 * ```
 *
 * Unlike `/api/sync`, a session is *not* narrowed to one listing here — the
 * body only ever names one, so there is no whole-crawl shape to refuse.
 *
 * A press is manual by definition, so the Firecrawl cooldown does not apply:
 * one credit, spent because somebody asked for it.
 */

import { NextResponse } from "next/server";
import { authorized, UUID_RE } from "@/lib/api-auth";
import { adminEnabled, createAdminClient } from "@/lib/supabase/admin";
import { emptyPhotoSync, type RefreshPhotosResponse } from "@/lib/photo-types";
import { syncListingPhotos } from "@/lib/photos-sync";
import type { Uuid } from "@/lib/types";

export const runtime = "nodejs";
/**
 * The ladder (8s direct, up to 82s of Firecrawl) plus twelve images fetched
 * four at a time. 60s is the fetch alone on a bad day.
 */
export const maxDuration = 120;

export async function POST(request: Request): Promise<NextResponse<RefreshPhotosResponse>> {
  // Before the body is read: the anon key alone must not be able to make this
  // server go and scrape somebody's listing page on a loop.
  if (!(await authorized(request))) {
    return json({ ...emptyPhotoSync(), error: "Not for you." }, 401);
  }

  if (!adminEnabled()) {
    return json(
      {
        ...emptyPhotoSync(),
        disabled: true,
        error: "Photos aren't configured on this deployment.",
      },
      503,
    );
  }

  const body = (await request.json().catch(() => null)) as {
    listingId?: unknown;
    personId?: unknown;
  } | null;
  if (!body) return json({ ...emptyPhotoSync(), error: "Send some JSON." }, 400);

  const listingId = typeof body.listingId === "string" ? body.listingId.trim() : "";
  if (!UUID_RE.test(listingId)) {
    return json({ ...emptyPhotoSync(), error: "Which listing?" }, 400);
  }
  const personId = typeof body.personId === "string" ? body.personId.trim() : null;

  const admin = createAdminClient();
  const { data: listing, error } = await admin
    .from("listings")
    .select("id, url")
    .eq("id", listingId)
    .maybeSingle();
  if (error) {
    console.error("[photos] refresh lookup failed", error);
    return json({ ...emptyPhotoSync(), error: "Couldn't check that listing." }, 500);
  }
  if (!listing) return json({ ...emptyPhotoSync(), error: "That listing is gone." }, 404);

  const url = (listing.url as string | null) ?? "";
  // A hand-typed listing has no page to go back to. That is not a failure
  // worth a 500 — the button is not rendered for those rows in the first place.
  if (!url) return json({ ...emptyPhotoSync(), error: "That listing has no link." }, 400);

  const result = await syncListingPhotos({
    admin,
    listingId: listingId as Uuid,
    url,
    personId,
    manual: true,
  });

  return json(result);
}

function json(body: RefreshPhotosResponse, status = 200): NextResponse<RefreshPhotosResponse> {
  return NextResponse.json(body, { status });
}
