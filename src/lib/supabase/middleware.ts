import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { supabaseEnv } from "./env";

/**
 * A signed-out request to an API route gets a 401 in JSON rather than a 307 to
 * the login page: the caller is a `fetch`, and handing it an HTML login screen
 * with a 200 means the client sees "unreadable response" instead of "sign in
 * again". Same fail-closed decision, answered in the caller's language.
 *
 * The routes themselves check the session too — this is the outer guard, not
 * the only one.
 */
function apiUnauthorized(error: string) {
  return NextResponse.json({ error }, { status: 401 });
}

/**
 * Refreshes the auth session cookie and guards routes.
 * Called from `src/proxy.ts` (Next 16's renamed middleware).
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const isApi = request.nextUrl.pathname.startsWith("/api/");
  /**
   * The one route that is allowed to arrive signed out: pg_cron POSTs
   * `/api/sync` with a bearer token and no cookies whatsoever, and this guard
   * would answer it 401 before the route could compare that token. The route
   * checks `CRON_SECRET` itself (constant time) and falls back to `getUser()`
   * for the "Check now" button, so nothing is unlocked here — the decision is
   * simply made one layer in.
   */
  const isCron = request.nextUrl.pathname === "/api/sync";

  const { url, key } = supabaseEnv();
  // No env means no way to check the session, so fail closed: everything but
  // the login screen goes to the login screen. Passing through used to hand a
  // misconfigured deployment the whole app, which then threw the moment it
  // tried to build a Supabase client. `/login` still renders, and says so.
  if (!url || !key) {
    if (isCron) return response;
    if (isApi) return apiUnauthorized("Supabase isn't configured.");
    if (request.nextUrl.pathname === "/login") return response;
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/login";
    redirect.search = "";
    return NextResponse.redirect(redirect);
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        for (const [k, v] of Object.entries(headers ?? {})) {
          response.headers.set(k, v);
        }
      },
    },
  });

  // Must run before the response is generated so refreshed cookies are written.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isLogin = pathname === "/login";

  if (!user && !isLogin) {
    if (isCron) return response;
    if (isApi) return apiUnauthorized("Sign in first.");
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/login";
    redirect.search = "";
    return NextResponse.redirect(redirect);
  }

  if (user && isLogin) {
    const redirect = request.nextUrl.clone();
    redirect.pathname = "/";
    redirect.search = "";
    return NextResponse.redirect(redirect);
  }

  return response;
}
