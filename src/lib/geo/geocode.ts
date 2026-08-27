import "server-only";

/**
 * Address → coordinates, twice, for free.
 *
 * 1. **NYC GeoSearch** (`geosearch.planninglabs.nyc`, NYC Planning Labs,
 *    Pelias under the hood). No key, no quota, NYC-only, and better at a New
 *    York address than anything with a global index — it knows that "214 Grand
 *    St" without a borough is probably Manhattan and says how sure it is.
 * 2. **Nominatim** (OpenStreetMap), bounded to a New York viewbox, only when
 *    rung one found nothing. Their usage policy is one request per second and
 *    a real `User-Agent` with a contact address, both of which are honoured
 *    here — which is also why it is the fallback and not the default.
 *
 * Both hosts are constants in this file. Nothing a person types reaches a URL
 * except as a query-string value, so there is no SSRF surface to guard: the
 * import ladder's `assertSafeUrl` exists because *there* the person supplies
 * the host.
 *
 * Server-only: the results are written with the admin client by
 * `POST /api/geocode`, and one shared cache of "who has looked recently" is
 * the point of doing it here rather than in a browser.
 */

export type GeocodeSource = "nyc-geosearch" | "nominatim";

export type GeocodeResult = {
  lat: number;
  lng: number;
  source: GeocodeSource;
  /** 0..1 where the provider offers one, null where it does not. */
  confidence: number | null;
  /** Below `LOW_CONFIDENCE`, or a fallback match: worth a human glance. */
  lowConfidence: boolean;
  /** What the provider thinks it matched — a borough, when it says so. */
  borough: string | null;
};

/** Why nothing could be returned. Maps to a status in the route. */
export type GeocodeFailure = "empty" | "not_found" | "unavailable";

export class GeocodeError extends Error {
  readonly reason: GeocodeFailure;
  constructor(reason: GeocodeFailure, message: string) {
    super(message);
    this.name = "GeocodeError";
    this.reason = reason;
  }
}

/** Pelias confidence below this is a guess worth flagging ("⚠ check pin"). */
export const LOW_CONFIDENCE = 0.7;

const GEOSEARCH_URL = "https://geosearch.planninglabs.nyc/v2/search";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

/** Their policy: identify yourself, with a way to be shouted at. */
const NOMINATIM_UA = "apartment-quest (lohikansun@gmail.com)";

/** Roughly the five boroughs plus a margin. `left,top,right,bottom`. */
const NYC_VIEWBOX = "-74.3,40.95,-73.7,40.5";

/** A provider that has not answered in six seconds is not going to. */
const TIMEOUT_MS = 6_000;

/** Nominatim's published limit is one request a second. Ours is slower. */
const NOMINATIM_MIN_GAP_MS = 1_100;

/**
 * Unit designators, stripped before the address is sent. A geocoder asked for
 * "214 Grand St #4B" either ignores the unit or, worse, matches a different
 * building whose *number* is 4 — and the apartment number was never going to
 * move the pin anyway.
 */
const UNIT_PATTERNS: RegExp[] = [
  /,?\s*#\s*[\w-]+\s*$/i,
  /,?\s*\b(?:apt|apartment|unit|ste|suite|rm|room|fl|floor|no|number)\b\.?\s*[\w-]+\s*$/i,
  /,?\s*\b(?:apt|apartment|unit|ste|suite|rm|room|fl|floor)\b\.?\s*[\w-]+\s*,/i,
];

/**
 * Already-anchored addresses: a borough, a state, a zip, or the city itself.
 * Appending ", New York, NY" to "350 5th Ave, Brooklyn, NY 11215" would give
 * Pelias two cities to choose between.
 */
const ANCHORED =
  /\b(?:new york|ny|n\.y\.|nyc|manhattan|brooklyn|queens|bronx|staten island|\d{5}(?:-\d{4})?)\b\.?\s*$/i;

/**
 * What actually gets sent. Pure and tested: the unit comes off, whitespace and
 * stray commas collapse, and ", New York, NY" is appended unless the address
 * already says where it is.
 */
export function normalizeForGeocode(address: string): string {
  let text = (address ?? "").trim();
  for (const pattern of UNIT_PATTERNS) {
    text = text.replace(pattern, (match) => (match.trimEnd().endsWith(",") ? ", " : ""));
  }
  text = text
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/(?:\s*,)+\s*$/, "")
    .trim();
  if (!text) return "";
  return ANCHORED.test(text) ? text : `${text}, New York, NY`;
}

/** One fetch with a deadline. An abort reads as "unavailable", not "not found". */
async function getJson(url: string, headers?: Record<string, string>): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", ...headers },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new GeocodeError("unavailable", `geocoder answered ${res.status}`);
    return await res.json();
  } catch (error) {
    if (error instanceof GeocodeError) throw error;
    throw new GeocodeError("unavailable", "The address lookup didn't answer.");
  } finally {
    clearTimeout(timer);
  }
}

/** NYC Planning Labs. `[lng, lat]`, `properties.confidence`, `properties.borough`. */
async function geosearch(text: string): Promise<GeocodeResult | null> {
  const url = `${GEOSEARCH_URL}?text=${encodeURIComponent(text)}&size=1`;
  const body = (await getJson(url)) as {
    features?: {
      geometry?: { coordinates?: unknown };
      properties?: { confidence?: unknown; borough?: unknown };
    }[];
  };
  const feature = body?.features?.[0];
  const coords = feature?.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const lng = Number(coords[0]);
  const lat = Number(coords[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const raw = feature?.properties?.confidence;
  const confidence = typeof raw === "number" && Number.isFinite(raw) ? raw : null;
  const borough =
    typeof feature?.properties?.borough === "string" ? feature.properties.borough : null;
  return {
    lat,
    lng,
    source: "nyc-geosearch",
    confidence,
    lowConfidence: confidence !== null && confidence < LOW_CONFIDENCE,
    borough,
  };
}

/**
 * Nominatim, serialised. Their policy is one request a second from a given
 * client and the queue below is how this process keeps that promise even when
 * "Locate all" fires eight addresses at once — each waits its turn rather than
 * getting us banned.
 */
let nominatimQueue: Promise<unknown> = Promise.resolve();
let lastNominatimAt = 0;

function throttleNominatim<T>(run: () => Promise<T>): Promise<T> {
  const next = nominatimQueue.then(async () => {
    const wait = lastNominatimAt + NOMINATIM_MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    try {
      return await run();
    } finally {
      lastNominatimAt = Date.now();
    }
  });
  // The queue must survive a rejection, or one failed lookup wedges every
  // later one behind it.
  nominatimQueue = next.catch(() => undefined);
  return next;
}

async function nominatim(text: string): Promise<GeocodeResult | null> {
  const url =
    `${NOMINATIM_URL}?q=${encodeURIComponent(text)}` +
    `&format=jsonv2&limit=1&viewbox=${NYC_VIEWBOX}&bounded=1`;
  const body = (await throttleNominatim(() =>
    getJson(url, { "User-Agent": NOMINATIM_UA }),
  )) as { lat?: unknown; lon?: unknown; importance?: unknown }[] | null;
  const hit = Array.isArray(body) ? body[0] : null;
  if (!hit) return null;
  const lat = Number(hit.lat);
  const lng = Number(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    lat,
    lng,
    source: "nominatim",
    // `importance` is a popularity score, not a match confidence — reporting
    // it as one would be a number that means something else.
    confidence: null,
    // Rung two ran because rung one, which is the one that actually knows New
    // York, found nothing. That is worth a glance by definition.
    lowConfidence: true,
    borough: null,
  };
}

/**
 * The ladder. Throws `GeocodeError` when neither provider could place the
 * address; never returns coordinates it does not believe in.
 */
export async function geocodeAddress(
  address: string,
  unit?: string | null,
): Promise<GeocodeResult> {
  void unit; // deliberately not sent — see UNIT_PATTERNS
  const text = normalizeForGeocode(address);
  if (!text) throw new GeocodeError("empty", "There's no address to look up.");

  let unavailable: GeocodeError | null = null;

  try {
    const hit = await geosearch(text);
    if (hit) return hit;
  } catch (error) {
    // A provider being down is not the same as an address not existing: keep
    // the reason, try the other one, and only report it if that fails too.
    unavailable = error instanceof GeocodeError ? error : null;
  }

  try {
    const hit = await nominatim(text);
    if (hit) return hit;
  } catch (error) {
    unavailable = error instanceof GeocodeError ? error : unavailable;
  }

  if (unavailable) throw unavailable;
  throw new GeocodeError("not_found", "Couldn't find that address in New York.");
}

/** The note stored on the listing, so a pin carries its own provenance. */
export function geocodeNote(result: GeocodeResult): string {
  return result.lowConfidence ? `low-confidence (${result.source})` : result.source;
}

/** …and the note stored when nobody could place it. */
export function geocodeFailureNote(error: unknown): string {
  const reason =
    error instanceof GeocodeError ? error.message : "The address lookup didn't answer.";
  return `failed: ${reason}`;
}
