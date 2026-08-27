import "server-only";

/**
 * Two doors, shared by every route that has both callers.
 *
 * - **A machine** — pg_cron, or a curl in a terminal — arrives with
 *   `Authorization: Bearer $CRON_SECRET`, no cookies at all, and is compared in
 *   constant time.
 * - **A person** — a button in the app — arrives with the logged-in session.
 *
 * A browser cannot hold `CRON_SECRET`, and the cron cannot hold a session, so
 * neither door is a weakening of the other. `/api/sync` narrows the person's
 * door further (a session may only ask about one listing, never a whole crawl);
 * `/api/geocode` and `/api/commutes` do not need to, because their work is
 * bounded by rows that already exist.
 */

import { timingSafeEqual } from "node:crypto";
import { createClient } from "@/lib/supabase/server";

/** The bearer token on a request, if it carries one. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  return /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim() ?? null;
}

/**
 * Constant-time, and false when there is no secret to match at all — a
 * deployment that forgot `CRON_SECRET` refuses every cron call rather than
 * accepting an empty one.
 */
export function secretMatches(candidate: string): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(secret);
  // `timingSafeEqual` throws on a length mismatch, which would itself leak the
  // length; compare `a` with itself instead and return false regardless.
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

/** Did this request come from the cron (or a terminal holding the secret)? */
export function cronAuthorized(request: Request): boolean {
  const bearer = bearerToken(request);
  return bearer ? secretMatches(bearer) : false;
}

/** Is there a logged-in Supabase session on this request's cookies? */
export async function hasSession(): Promise<boolean> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return Boolean(user);
  } catch {
    return false;
  }
}

/** Either door. What `/api/geocode` and `/api/commutes` ask. */
export async function authorized(request: Request): Promise<boolean> {
  if (cronAuthorized(request)) return true;
  return hasSession();
}
