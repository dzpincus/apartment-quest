import "server-only";

/**
 * `POST /api/geocode` — put a listing on the map.
 *
 *   { listingId }        geocode the stored address and write the pin
 *   { address, unit? }   just tell me where that is (the locations dialog's
 *                        preview, before there is a row to write to)
 *
 * Two doors, both from `src/lib/api-auth.ts`: the logged-in session (every
 * button that calls this) or `Authorization: Bearer $CRON_SECRET` (a terminal,
 * for testing and for backfilling by hand). The lookup itself is
 * `src/lib/geo/geocode.ts`: NYC GeoSearch, then Nominatim, both free, both
 * fixed hosts.
 *
 * A failure is written down rather than swallowed. `geocode_note` gets
 * `failed: …` and `geocoded_at` gets the timestamp of the attempt, so the
 * detail page can say "we looked and could not find it" — which is a different
 * sentence from "nobody has looked yet" — and the automatic geocode after an
 * address edit cannot loop.
 */

import { NextResponse } from "next/server";
import { authorized, UUID_RE } from "@/lib/api-auth";
import { adminEnabled, createAdminClient } from "@/lib/supabase/admin";
import {
  geocodeAddress,
  geocodeFailureNote,
  geocodeNote,
  GeocodeError,
} from "@/lib/geo/geocode";
import type { GeocodeResponse } from "@/lib/geo-types";
import type { Uuid } from "@/lib/types";

export const runtime = "nodejs";
/** Two providers at six seconds each, plus the Nominatim politeness gap. */
export const maxDuration = 30;

/** Longer than any real street address, and shorter than an attack. */
const MAX_ADDRESS = 300;

function json(body: GeocodeResponse, status = 200) {
  return NextResponse.json(body, { status });
}

function empty(): GeocodeResponse {
  return { lat: null, lng: null, source: null, lowConfidence: false };
}

export async function POST(request: Request): Promise<NextResponse<GeocodeResponse>> {
  // Before the body is read: the anon key alone must not be able to make this
  // server call two geocoders on a loop.
  if (!(await authorized(request))) {
    return json({ ...empty(), error: "Not for you." }, 401);
  }

  const body = (await request.json().catch(() => null)) as {
    listingId?: unknown;
    address?: unknown;
    unit?: unknown;
  } | null;
  if (!body) return json({ ...empty(), error: "Send some JSON." }, 400);

  const listingId = typeof body.listingId === "string" ? body.listingId.trim() : "";
  const rawAddress = typeof body.address === "string" ? body.address.trim() : "";
  const rawUnit = typeof body.unit === "string" ? body.unit.trim() : null;

  if (listingId) {
    if (!UUID_RE.test(listingId)) return json({ ...empty(), error: "Which listing?" }, 400);
    return locateListing(listingId);
  }

  if (!rawAddress) return json({ ...empty(), error: "Send an address." }, 400);
  if (rawAddress.length > MAX_ADDRESS) {
    return json({ ...empty(), error: "That address is too long." }, 400);
  }

  // The preview path: no row, no write, just coordinates for a map pin the
  // person is still typing into a form.
  try {
    const hit = await geocodeAddress(rawAddress, rawUnit);
    return json({
      lat: hit.lat,
      lng: hit.lng,
      source: hit.source,
      lowConfidence: hit.lowConfidence,
    });
  } catch (error) {
    return json({ ...empty(), error: message(error) }, status(error));
  }
}

/** Geocode the stored address and write the pin with the admin client. */
async function locateListing(listingId: Uuid): Promise<NextResponse<GeocodeResponse>> {
  if (!adminEnabled()) {
    return json(
      { ...empty(), disabled: true, error: "Geocoding isn't configured on this deployment." },
      503,
    );
  }
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("listings")
    .select("id, address, unit")
    .eq("id", listingId)
    .maybeSingle();
  if (error) {
    console.error("[geocode] listing read failed", error);
    return json({ ...empty(), error: "Couldn't read that listing." }, 500);
  }
  if (!data) return json({ ...empty(), error: "No such listing." }, 404);

  const listing = data as { id: Uuid; address: string; unit: string | null };

  try {
    const hit = await geocodeAddress(listing.address, listing.unit);
    const { error: writeError } = await admin
      .from("listings")
      .update({
        lat: hit.lat,
        lng: hit.lng,
        geocoded_at: new Date().toISOString(),
        geocode_note: geocodeNote(hit),
      })
      .eq("id", listing.id);
    if (writeError) {
      console.error("[geocode] listing write failed", writeError);
      return json({ ...empty(), error: "Couldn't save the pin." }, 500);
    }
    console.info("[geocode] located", {
      listingId: listing.id,
      source: hit.source,
      lowConfidence: hit.lowConfidence,
    });
    return json({
      lat: hit.lat,
      lng: hit.lng,
      source: hit.source,
      lowConfidence: hit.lowConfidence,
      listingId: listing.id,
    });
  } catch (failure) {
    // Record the attempt. Without the stamp the automatic geocode fires again
    // on every read of a listing nobody can place.
    const note = geocodeFailureNote(failure);
    const { error: writeError } = await admin
      .from("listings")
      .update({ geocoded_at: new Date().toISOString(), geocode_note: note })
      .eq("id", listing.id);
    if (writeError) console.error("[geocode] failure note write failed", writeError);
    console.info("[geocode] not located", { listingId: listing.id, note });
    return json(
      { ...empty(), listingId: listing.id, error: message(failure) },
      status(failure),
    );
  }
}

/** A provider being down is a 503; an address that does not exist is a 422. */
function status(error: unknown): number {
  if (error instanceof GeocodeError) {
    if (error.reason === "unavailable") return 503;
    if (error.reason === "empty") return 400;
    return 422;
  }
  return 500;
}

function message(error: unknown): string {
  if (error instanceof GeocodeError) return error.message;
  console.error("[geocode] unexpected", error);
  return "Couldn't look that address up.";
}
