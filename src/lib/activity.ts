/**
 * Where an activity row points.
 *
 * Summaries are pre-rendered at write time (`mutations.ts`), so the feed has no
 * idea what any given line is *about* beyond its verb and its entity. This is
 * the one place that decision lives, so the feed can make every row that has a
 * destination tappable and leave the rest as text.
 *
 * Pure and dependency-free — `src/lib/types.ts` is types only.
 */

import type { ActivityVerb, EntityType, Uuid } from "@/lib/types";

/** The three columns the destination is derived from. */
export type ActivityTarget = {
  verb: ActivityVerb;
  entity_type: EntityType | null;
  entity_id: Uuid | null;
};

/**
 * The href for an activity row, or `null` when there is nowhere useful to go.
 *
 * - a listing (any verb) -> that listing
 * - `messaged` about a listing -> that listing's thread (`#thread`, which the
 *   detail page scrolls to, and arriving marks it read)
 * - `messaged` with no listing -> the group chat. `postMessage` files a global
 *   message under `entity_type: "message"` and its own id, so there is no
 *   listing to link and `/chat` is the whole destination.
 * - `added_broker` -> the brokers page. There is no per-broker route, and the
 *   list is short.
 * - anything else (`updated_document`, a row with no entity) -> `null`
 */
export function activityHref(item: ActivityTarget): string | null {
  const id = item.entity_id;

  if (item.entity_type === "listing" && id) {
    return item.verb === "messaged" ? `/listings/${id}#thread` : `/listings/${id}`;
  }
  // A global message: filed under the message itself, so the id is not a route.
  if (item.verb === "messaged") return "/chat";
  if (item.verb === "added_broker") return "/brokers";
  return null;
}
