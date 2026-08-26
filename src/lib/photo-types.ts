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
