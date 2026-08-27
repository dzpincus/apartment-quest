import "server-only";

/**
 * Walk, bike and transit durations from the Google Routes API.
 *
 * `POST https://routes.googleapis.com/directions/v2:computeRoutes` with a field
 * mask of `routes.duration,routes.distanceMeters` — the smallest possible
 * response, which is also the cheapest SKU. It is the only mainstream API that
 * does New York transit properly, and the free monthly quota is far more than
 * four people looking at sixty apartments will ever spend, because every answer
 * is cached in `commute_times` and computed once.
 *
 * Server-only, and the key never leaves this process: `GOOGLE_MAPS_API_KEY` is
 * not `NEXT_PUBLIC_`, the map itself is MapLibre + OpenFreeMap (no Google), and
 * the "open in Google Maps" links the UI shows are plain deep links that need
 * no key at all.
 *
 * TOS note: Routes results are displayed without a Google map, which is allowed
 * as long as "Powered by Google" appears with them — see the commute card.
 */

import { TZDate } from "@date-fns/tz";
import { NY_TZ } from "@/lib/time";
import type { CommuteMode } from "@/lib/types";
import type { LatLng } from "./haversine";

const ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";

/** Ours → theirs. `bike` is `BICYCLE`; getting this wrong is a silent 400. */
export const GOOGLE_TRAVEL_MODE: Record<CommuteMode, "WALK" | "BICYCLE" | "TRANSIT"> = {
  walk: "WALK",
  bike: "BICYCLE",
  transit: "TRANSIT",
};

/** One call's deadline. Four in flight, 120s of function — 8s each fits. */
export const ROUTE_TIMEOUT_MS = 8_000;

/** No key means the feature does not exist on this deployment: a 503, not a 500. */
export class RoutesDisabledError extends Error {
  constructor() {
    super("Commute times aren't configured on this deployment.");
    this.name = "RoutesDisabledError";
  }
}

/**
 * A pair either has an answer or has a sentence explaining why it does not.
 * Nothing below `computeRoute` throws except `RoutesDisabledError`: a batch of
 * 900 pairs must not die because one of them crossed a river with no bridge.
 */
export type RouteOutcome =
  | { ok: true; seconds: number; meters: number }
  | { ok: false; error: string };

export type RouteRequest = {
  origin: LatLng;
  destination: LatLng;
  mode: CommuteMode;
  /** Overridable for tests; defaults to the next weekday 9:00 in New York. */
  departureTime?: string;
};

export function routesEnabled(): boolean {
  return Boolean(process.env.GOOGLE_MAPS_API_KEY);
}

/**
 * Transit needs a *when*, and "now" would mean a listing looked at on Sunday
 * night compares badly with the same listing looked at on Tuesday morning. The
 * next weekday at 9:00 New York time is a fixed, comparable rush hour, and it
 * is always in the future — Google refuses a departure in the past.
 *
 * Weekend → Monday. A weekday before 9:00 → today. A weekday after → the next
 * weekday, so Friday afternoon also lands on Monday.
 *
 * The day arithmetic is done on a UTC calendar date with no instant attached,
 * so a DST change cannot move it; only the final 9:00 is built in New York.
 */
export function nextWeekdayNineAmNY(now: Date = new Date()): string {
  const ny = new TZDate(now, NY_TZ);
  const day = new Date(Date.UTC(ny.getFullYear(), ny.getMonth(), ny.getDate()));
  const isWeekend = (d: Date) => d.getUTCDay() === 0 || d.getUTCDay() === 6;
  const beforeNine = ny.getHours() < 9;

  if (!beforeNine || isWeekend(day)) {
    do {
      day.setUTCDate(day.getUTCDate() + 1);
    } while (isWeekend(day));
  }

  const nineAm = new TZDate(
    day.getUTCFullYear(),
    day.getUTCMonth(),
    day.getUTCDate(),
    9,
    0,
    0,
    NY_TZ,
  );
  // Back through a plain Date for the string: `TZDate#toISOString` keeps the
  // zone offset (`…T09:00:00.000-05:00`), and Google asks for RFC3339 in UTC.
  // Both name the same instant; only one of them is what the API documents.
  return new Date(nineAm.getTime()).toISOString();
}

/** `"1234s"` → `1234`. Google sends a protobuf Duration, which is a string. */
export function parseDurationSeconds(duration: unknown): number | null {
  if (typeof duration === "number" && Number.isFinite(duration)) return Math.round(duration);
  if (typeof duration !== "string") return null;
  const m = /^(\d+(?:\.\d+)?)s$/.exec(duration.trim());
  if (!m) return null;
  const seconds = Number(m[1]);
  return Number.isFinite(seconds) ? Math.round(seconds) : null;
}

/**
 * Google's own words, turned into a sentence worth storing in `error`.
 *
 * 403 is almost always billing or an API-key restriction and 400 is almost
 * always a request this code got wrong — both are deployment problems, and
 * neither is a reason to abandon the other 899 pairs, so they are returned
 * rather than thrown.
 */
export function routeErrorMessage(status: number, body: unknown): string {
  const message = (body as { error?: { message?: unknown } })?.error?.message;
  const detail = typeof message === "string" && message ? message : null;
  if (status === 403) {
    return detail ?? "Google refused the key (billing or API restrictions).";
  }
  if (status === 400) return detail ?? "Google rejected the request.";
  if (status === 429) return detail ?? "Google rate-limited us — try again later.";
  return detail ?? `Google answered ${status}.`;
}

/**
 * One origin, one destination, one mode. An empty `routes` array is not an
 * error on Google's side — it means there is no such route (no ferry, no
 * bridge, nothing running at that hour) — and it is stored as one here.
 */
export async function computeRoute(request: RouteRequest): Promise<RouteOutcome> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new RoutesDisabledError();

  const travelMode = GOOGLE_TRAVEL_MODE[request.mode];
  const body: Record<string, unknown> = {
    origin: { location: { latLng: latLng(request.origin) } },
    destination: { location: { latLng: latLng(request.destination) } },
    travelMode,
  };
  // Only TRANSIT takes a departure time; sending one with WALK is a 400.
  if (travelMode === "TRANSIT") {
    body.departureTime = request.departureTime ?? nextWeekdayNineAmNY();
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ROUTE_TIMEOUT_MS);
  try {
    const res = await fetch(ROUTES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "routes.duration,routes.distanceMeters",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
    const json = (await res.json().catch(() => null)) as unknown;
    if (!res.ok) return { ok: false, error: routeErrorMessage(res.status, json) };

    const route = (json as { routes?: { duration?: unknown; distanceMeters?: unknown }[] })
      ?.routes?.[0];
    const seconds = parseDurationSeconds(route?.duration);
    if (seconds === null) return { ok: false, error: "No route." };
    const meters = Number(route?.distanceMeters);
    return { ok: true, seconds, meters: Number.isFinite(meters) ? Math.round(meters) : 0 };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return { ok: false, error: aborted ? "Google took too long." : "Couldn't reach Google." };
  } finally {
    clearTimeout(timer);
  }
}

function latLng(point: LatLng) {
  return { latitude: point.lat, longitude: point.lng };
}
