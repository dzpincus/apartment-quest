"use client";

/**
 * TODO(part3): the listing-photos hook.
 *
 * Part 1 (URL import) finds photo URLs and lets the user tick the good ones;
 * Part 3 is what copies them into Supabase Storage. That route does not exist
 * yet, so this is deliberately a no-op: the *wiring* is finished — the panel
 * reports the selection, the dialog holds it, and `createListing` calls this
 * with the new listing's id — and Part 3's only job here is to replace the
 * body of `savePhotos` with the `POST /api/photos` call.
 *
 * Fire-and-forget by contract. Saving photos must never block the navigation
 * to the listing that was just created, and a failure here is a toast, not a
 * lost listing.
 */

export type SavePhotosResult = { saved: number; failed: string[] };

export async function savePhotos(
  listingId: string,
  urls: string[],
  personId?: string | null,
): Promise<SavePhotosResult> {
  if (urls.length === 0) return { saved: 0, failed: [] };

  // TODO(part3): replace with
  //   const res = await fetch("/api/photos", {
  //     method: "POST",
  //     headers: { "Content-Type": "application/json" },
  //     body: JSON.stringify({ listingId, urls, personId }),
  //   });
  console.info("[photos] TODO(part3): would save photos", {
    listingId,
    personId: personId ?? null,
    count: urls.length,
    urls,
  });
  return { saved: 0, failed: [] };
}

/** Whether the storage route exists yet. Part 3 flips this to `true`. */
export const PHOTO_SAVING_ENABLED = false;
