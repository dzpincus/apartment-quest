import "server-only";

/**
 * Go back to a listing page and pick up the photos it has published since.
 *
 * Listing sites are not finished when they go live. A broker shoots the empty
 * apartment on Monday, the floor plan lands on Wednesday, and the four
 * pictures we copied at import time are still the only four we have — which is
 * the version of the apartment everybody votes on.
 *
 * Two callers, one function:
 *
 * - `POST /api/photos/refresh` — the **Refresh photos** button, which has no
 *   HTML and climbs the ladder itself.
 * - `POST /api/sync` — the twice-daily crawl, which has *already* fetched the
 *   page to decide whether the listing is still live and passes that HTML
 *   straight in. Fetching somebody's listing page twice in one run to answer
 *   two questions about it is rude and slow.
 *
 * **Nothing new is the expected answer**, and it has to be cheap: the whole
 * point of `photoSourceKey` (`import/photo-key.ts`) is that a page re-serving
 * the same eight pictures at different renditions costs one database read and
 * no uploads at all. Nothing about the identity is stored — it is computed on
 * both sides at compare time, from `listing_photos.source_url`, which is null
 * for a manual upload and therefore never a duplicate of anything.
 *
 * A failure here is never allowed to matter to its caller. The sync run's job
 * is `listing_state`; a photo CDN having a bad afternoon must not cost a
 * listing its state write.
 */

import { fetchPage } from "@/lib/import/fetch-page";
import { firecrawlEnabled, scrapeWithFirecrawl } from "@/lib/import/firecrawl";
import { discoverPhotos } from "@/lib/import/photos";
import { listingLabel } from "@/lib/format";
import {
  MAX_NEW_PHOTOS_PER_RUN,
  pickNewPhotos,
  RESYNC_DISCOVER_CAP,
} from "@/lib/photo-resync";
import { emptyPhotoSync, type PhotoSyncResult } from "@/lib/photo-types";
import {
  type Admin,
  botPersonId,
  originOf,
  resolvePerson,
  storePhotos,
} from "@/lib/photos-server";
import { recentlyBlocked } from "@/lib/sync-types";
import type { Uuid } from "@/lib/types";

export type SyncListingPhotosInput = {
  admin: Admin;
  listingId: Uuid;
  /** The listing page. Used to fetch, and as the base for relative image URLs. */
  url: string;
  /**
   * The page, if the caller already has it. `/api/sync` always does; the
   * refresh button never does and pays for the ladder.
   */
  html?: string | null;
  /** Who pressed the button. Absent means the crawl, which signs as Quest Bot. */
  personId?: string | null;
  /** Overrides the listing's own origin as the image CDN's `Referer`. */
  referer?: string | null;
  /**
   * A manual press is exempt from the Firecrawl cooldown — one credit, asked
   * for on purpose. The crawl is not.
   */
  manual?: boolean;
  /** Fewer than the usual twelve, when a whole run's budget is nearly spent. */
  cap?: number;
};

export async function syncListingPhotos({
  admin,
  listingId,
  url,
  html,
  personId,
  referer,
  manual = false,
  cap = MAX_NEW_PHOTOS_PER_RUN,
}: SyncListingPhotosInput): Promise<PhotoSyncResult & { error?: string }> {
  if (cap <= 0) return emptyPhotoSync();

  // The label for the feed line and the note for the cooldown come from the
  // same read the existence check needs anyway.
  const { data: listing, error: listingError } = await admin
    .from("listings")
    .select("id, address, unit, url, state_note, state_checked_at")
    .eq("id", listingId)
    .maybeSingle();
  if (listingError) {
    console.error("[photos] resync listing lookup failed", listingError);
    return { ...emptyPhotoSync(), error: "Couldn't check that listing." };
  }
  if (!listing) return { ...emptyPhotoSync(), error: "That listing is gone." };

  const pageUrl = (url || (listing.url as string | null) || "").trim();
  if (!pageUrl) return { ...emptyPhotoSync(), error: "That listing has no link." };

  let markup = html ?? null;
  if (!markup) {
    const fetched = await fetchPageForPhotos(pageUrl, {
      manual,
      note: listing.state_note as string | null,
      checkedAt: listing.state_checked_at as string | null,
    });
    if (!fetched.ok) {
      return { ...emptyPhotoSync(), blocked: true, error: fetched.reason };
    }
    markup = fetched.html;
  }

  // Deliberately deeper than the twelve an import takes: the photos we already
  // have are at the *front* of the page, so a discovery capped at twelve would
  // hand back exactly those twelve and every refresh would find nothing.
  const candidates = discoverPhotos(markup, {
    baseUrl: pageUrl,
    cap: RESYNC_DISCOVER_CAP,
  });
  if (candidates.length === 0) return emptyPhotoSync();

  const { data: existing, error: existingError } = await admin
    .from("listing_photos")
    .select("source_url")
    .eq("listing_id", listingId);
  if (existingError) {
    // Without the list of what we hold, every candidate looks new and the
    // gallery gets a second copy of itself. Refuse rather than duplicate.
    console.error("[photos] resync existing read failed", existingError);
    return {
      ...emptyPhotoSync(),
      discovered: candidates.length,
      error: "Couldn't read the photos we already have.",
    };
  }

  const { picked, skippedExisting, overCap } = pickNewPhotos(
    candidates,
    (existing ?? []).map((row) => row.source_url as string | null),
    cap,
  );

  if (picked.length === 0) {
    return {
      ...emptyPhotoSync(),
      discovered: candidates.length,
      skipped_existing: skippedExisting + overCap,
    };
  }

  // `added_by` names a human or nobody: Quest Bot has never been on a tour and
  // does not own a photo row. It *does* sign the feed line, because
  // `activity.person_id` is NOT NULL and "3 new photos appeared" is news
  // somebody should be able to attribute.
  const addedBy = await resolvePerson(admin, personId ?? null);
  const actorId = addedBy ?? (await botPersonId(admin));

  const result = await storePhotos({
    admin,
    listingId,
    items: picked,
    referer: referer ?? originOf(pageUrl),
    addedBy,
    actorId,
    label: listingLabel(listing.address as string, listing.unit as string | null),
    summary: (count, label) =>
      `added ${count} new ${count === 1 ? "photo" : "photos"} to ${label}`,
  });

  const added = result.photos.length;
  // A failed insert took every uploaded photo back out again, so all of them
  // failed — not just the ones that never encoded.
  const failed = result.fatal ? picked.length : result.attempts.length;
  console.info("[photos] resync", {
    listing: listingId,
    discovered: candidates.length,
    added,
    skipped: skippedExisting + overCap,
    failed,
  });

  return {
    discovered: candidates.length,
    added,
    skipped_existing: skippedExisting + overCap,
    failed,
    blocked: false,
    ...(result.fatal ? { error: result.fatal } : {}),
  };
}

/**
 * The ladder, with the sync run's appetite: direct fetch, then Firecrawl —
 * but only when this site has not already proved this week that it blocks us,
 * and always when a person is watching the button.
 */
async function fetchPageForPhotos(
  url: string,
  opts: { manual: boolean; note: string | null; checkedAt: string | null },
): Promise<{ ok: true; html: string } | { ok: false; reason: string }> {
  let direct;
  try {
    direct = await fetchPage(url);
  } catch (error) {
    // An unsafe or unresolvable URL: a stored link, not a request we make.
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
  if (direct.ok) return { ok: true, html: direct.html };

  const cooling = recentlyBlocked(opts.note, opts.checkedAt);
  if (firecrawlEnabled() && (opts.manual || !cooling)) {
    try {
      const scraped = await scrapeWithFirecrawl(url);
      if (scraped.ok && scraped.html) return { ok: true, html: scraped.html };
      return { ok: false, reason: scraped.ok ? "The page came back empty." : scraped.reason };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  return { ok: false, reason: direct.reason };
}
