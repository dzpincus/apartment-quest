import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { requireSupabaseEnv } from "./env";

/** Server Supabase client (RSC, route handlers, server actions). */
export async function createClient() {
  // Read cookies first: this marks the route as dynamic before anything can
  // throw, so a build without env vars never fails during prerender.
  const cookieStore = await cookies();
  const { url, key } = requireSupabaseEnv();

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component — the proxy refreshes the session,
          // so it is safe to ignore.
        }
      },
    },
  });
}
