/**
 * The wire shape of `POST /api/photos`, in a file with no `server-only` import.
 *
 * Both ends need it — the route returns it, `photos-client.ts` and
 * `mutations.ts` read it — and the route cannot be the home of a type a client
 * component imports: a `import type` from a route module is erased at build
 * time, but nothing stops the next edit from importing a *value* out of the
 * same file and dragging `sharp` into the browser bundle. Same reasoning as
 * `sync-types.ts`.
 */

import type { ListingPhoto } from "@/lib/types";

/** Why one image did not make it. `url` for the import path, `name` for a file. */
export type PhotoFailure = { url?: string; name?: string; reason: string };

export type SavePhotosResponse = {
  photos: ListingPhoto[];
  failed: PhotoFailure[];
  error?: string;
};

/**
 * A multipart upload bigger than this is refused on `content-length`, before
 * the body is read. Vercel caps a request body at 4.5MB, so a phone sending
 * twelve unshrunk photos gets a sentence from us rather than a platform-level
 * 413 with an HTML body the client cannot parse.
 */
export const MULTIPART_MAX_BYTES = 4_500_000;

/** The one message for that case, shared so the client can recognise its own. */
export const BATCH_TOO_BIG_MESSAGE = "Batch too big — add fewer photos at once";

/**
 * What one photo re-sync did: go back to the listing page and pick up
 * whatever it has published since we imported it.
 *
 * `discovered` is every candidate the page offered this time, and
 * `added + skipped_existing + failed` accounts for all of them bar the ones
 * over the per-run cap. `skipped_existing` is the number that matters: it is
 * the dedupe working, and a refresh that reports twelve of them found nothing
 * new rather than failing.
 *
 * `blocked` is not an error — a site that will not let us look is the normal
 * answer from Zillow and StreetEasy, and it says so in `error`.
 */
export type PhotoSyncResult = {
  discovered: number;
  added: number;
  skipped_existing: number;
  failed: number;
  blocked: boolean;
};

/** The wire shape of `POST /api/photos/refresh`. */
export type RefreshPhotosResponse = PhotoSyncResult & {
  /** Why it was blocked, or what went wrong. Never the whole story on its own. */
  error?: string;
  /** No `SUPABASE_SERVICE_ROLE_KEY` on this deployment. */
  disabled?: true;
};

/** The empty result, so every early return has the same shape. */
export function emptyPhotoSync(): PhotoSyncResult {
  return { discovered: 0, added: 0, skipped_existing: 0, failed: 0, blocked: false };
}
