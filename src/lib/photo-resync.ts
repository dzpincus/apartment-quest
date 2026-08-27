/**
 * Which photos on the page we have not got yet.
 *
 * The whole of the re-sync's decision, pure and in a file with no
 * `server-only` import, for the same reason `sync-types.ts` and
 * `photo-types.ts` exist: the rule is worth testing on its own, and a route
 * module that imports `sharp` is the wrong place to keep something a test —
 * or, one day, a client — wants to read.
 *
 * The comparison is `photoSourceKey` on both sides (`import/photo-key.ts`),
 * never the raw URL: a listing site re-serving the same picture at a different
 * rendition is not a new picture, and re-uploading eight of those every time
 * the cron runs is how a free storage tier disappears.
 */

import { photoSourceKey } from "@/lib/import/photo-key";

/**
 * How many *new* photos one refresh will copy. Twelve is the import's own cap
 * (`PHOTO_CAP` in `import/photos.ts`) and about 5MB of fetching; a page that
 * genuinely gained thirty pictures gets the rest on the next run.
 */
export const MAX_NEW_PHOTOS_PER_RUN = 12;

/**
 * How deep to look while discovering. Deliberately larger than the cap above
 * *and* than the import's twelve: if discovery stopped at twelve it would
 * hand back the twelve we already have and every refresh would find nothing.
 */
export const RESYNC_DISCOVER_CAP = 40;

/** Per `/api/sync` run, across every listing. A crawl is not a backfill. */
export const SYNC_PHOTO_BUDGET = 60;

export type PickedPhotos = {
  /** URLs worth fetching, in page order. */
  picked: string[];
  /** Already stored, a second rendition of one we just picked, or unusable. */
  skippedExisting: number;
  /** New, but over this run's cap. Next run's problem. */
  overCap: number;
};

/**
 * `candidates` is what the page offers today; `existingSourceUrls` is every
 * `listing_photos.source_url` we hold for the listing, nulls (manual uploads)
 * included and ignored.
 *
 * `picked + skippedExisting + overCap === candidates.length`, always — the
 * three counters are the response's `added` / `skipped_existing` line, so an
 * answer that does not add up is a bug report from the caller's toast.
 */
export function pickNewPhotos(
  candidates: readonly string[],
  existingSourceUrls: readonly (string | null | undefined)[],
  cap: number = MAX_NEW_PHOTOS_PER_RUN,
): PickedPhotos {
  const seen = new Set<string>();
  for (const url of existingSourceUrls) {
    const key = photoSourceKey(url);
    if (key) seen.add(key);
  }

  const picked: string[] = [];
  let skippedExisting = 0;
  let overCap = 0;

  for (const candidate of candidates) {
    const key = photoSourceKey(candidate);
    // No key means nothing we could fetch anyway, and it must not be counted
    // as "new" — it would be re-attempted on every single run.
    if (!key || seen.has(key)) {
      skippedExisting += 1;
      continue;
    }
    // Claim the key even when the cap refuses it: two renditions of the same
    // unseen photo are one photo, not one added and one deferred.
    seen.add(key);
    if (picked.length >= cap) {
      overCap += 1;
      continue;
    }
    picked.push(candidate);
  }

  return { picked, skippedExisting, overCap };
}
