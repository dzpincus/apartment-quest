import "server-only";

/**
 * The service-role Supabase client. Bypasses RLS, so it exists in exactly one
 * file and that file cannot be bundled for a browser: `server-only` turns an
 * accidental client import into a build error rather than a leaked key.
 *
 * Two callers, both server routes:
 * - `POST /api/photos` — storage uploads and the `listing_photos` rows.
 * - `POST /api/sync` (Part 2) — the cron run, which has no session at all.
 *
 * Everything a *person* does still goes through the anon key and RLS. This is
 * for work done on their behalf by the server, after the route has already
 * checked the session itself.
 *
 * `persistSession: false`: there is no session here to persist, and letting
 * supabase-js write one would mean a long-lived server process holding auth
 * state that belongs to nobody.
 */

import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

/** Missing key — a deployment problem, not a request problem. Maps to a 500. */
export class MissingServiceRoleKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingServiceRoleKeyError";
  }
}

export function adminEnabled(): boolean {
  return Boolean(
    process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL,
  );
}

export function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) {
    throw new MissingServiceRoleKeyError(
      "Missing NEXT_PUBLIC_SUPABASE_URL — the server can't reach Supabase.",
    );
  }
  if (!key) {
    throw new MissingServiceRoleKeyError(
      "Missing SUPABASE_SERVICE_ROLE_KEY. Add it to .env.local (server-only, never NEXT_PUBLIC_).",
    );
  }
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
