import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { supabaseEnv } from "./env";

/**
 * Refreshes the auth session cookie and guards routes.
 * Called from `src/proxy.ts` (Next 16's renamed middleware).
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const { url, key } = supabaseEnv();
  // No env means no way to check the session, so fail closed: everything but
  // the login screen goes to the login screen. Passing through used to hand a
  // misconfigured deployment the whole app, which then threw the moment it
  // tried to build a Supabase client. `/login` still renders, and says so.
  if (!url || !key) {
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
