"use client";

/**
 * The client half of listing photos: where a stored path becomes a URL, and
 * the one call the Add Listing dialog makes after a listing exists.
 *
 * Uploads and deletes made from a component go through `mutations.ts` like
 * every other write. `savePhotos` is the exception that proves the rule: it is
 * called from the dialog's submit handler *after* it has navigated away, so
 * there is no component left to own a mutation, and it is fire-and-forget by
 * contract — copying eight photos off a CDN must never hold up the trip to the
 * listing that was just created, and a photo that fails is a toast, not a lost
 * listing. The detail page picks the photos up as they land, over realtime.
 */

import { toast } from "sonner";
import type { PhotoFailure, SavePhotosResponse } from "@/lib/photo-types";

/** The public bucket from 0007_photos.sql. */
export const PHOTO_BUCKET = "listing-photos";

/** What the route answers with lives in `photo-types.ts`, which both ends import. */
export type { PhotoFailure, SavePhotosResponse };

export type SavePhotosResult = { saved: number; failed: PhotoFailure[] };

/**
 * A bucket path (`<listing_id>/<uuid>.webp`) as a URL.
 *
 * The bucket is public, so this is a plain CDN link with no signing round trip
 * — the paths carry a random uuid and the pictures are of apartments already
 * advertised on the open internet. Rows store the path and never the URL, so
 * moving to another Supabase project is an env change rather than a migration.
 *
 * Returns "" when the env var is missing, which renders as a broken tile
 * rather than as `undefined/storage/v1/...` in someone's network tab.
 */
export function photoUrl(path: string | null | undefined): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base || !path) return "";
  const clean = path.replace(/^\/+/, "");
  if (!clean) return "";
  const encoded = clean.split("/").map(encodeURIComponent).join("/");
  return `${base.replace(/\/+$/, "")}/storage/v1/object/public/${PHOTO_BUCKET}/${encoded}`;
}

/**
 * Copy the photos ticked in the import panel into storage.
 *
 * Progress is a single sonner toast that turns into its own result, because
 * this runs while the user is already reading the listing detail page: a
 * spinner they cannot see is worth nothing, a line that says "8 photos saved"
 * when it finishes is worth a lot.
 */
export async function savePhotos(
  listingId: string,
  urls: string[],
  personId?: string | null,
): Promise<SavePhotosResult> {
  if (urls.length === 0) return { saved: 0, failed: [] };

  const toastId = toast.loading(
    `Saving ${urls.length} ${urls.length === 1 ? "photo" : "photos"}…`,
  );

  try {
    const res = await fetch("/api/photos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ listingId, personId: personId ?? null, urls }),
    });
    const body = (await res.json().catch(() => null)) as SavePhotosResponse | null;

    const saved = body?.photos?.length ?? 0;
    const failed = body?.failed ?? [];

    if (saved === 0) {
      toast.error(body?.error ?? "Couldn't save those photos.", {
        id: toastId,
        description:
          failed.length > 0 ? `${failed.length} skipped — you can add them by hand.` : undefined,
      });
      return { saved: 0, failed };
    }

    toast.success(`${saved} ${saved === 1 ? "photo" : "photos"} saved`, {
      id: toastId,
      description:
        failed.length > 0
          ? `${failed.length} couldn't be copied from the listing site.`
          : undefined,
    });
    return { saved, failed };
  } catch {
    toast.error("Couldn't save those photos.", { id: toastId });
    return { saved: 0, failed: urls.map((url) => ({ url, reason: "network" })) };
  }
}
