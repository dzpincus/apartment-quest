import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Next 16 renamed `middleware` to `proxy`.
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

/**
 * Extensions served straight out of `public/`. None of them are secrets, and
 * all of them are fetched by something that cannot follow a redirect to a
 * login page usefully.
 *
 * That last part is the reason this list exists. A `new Worker(url)` or a
 * `<script type="module">` fetches with `credentials: "omit"`, so it arrives
 * at the proxy with no session cookie no matter who is signed in, gets a 307
 * to `/login`, follows it, and receives HTML. The browser then reports a MIME
 * type error against the *script*, which points nowhere near the redirect
 * that caused it. MapLibre's worker (`/maplibre-gl-worker.mjs`) is exactly
 * this case, and the subway data under `/data/` is the same shape.
 *
 * `.mjs` is not optional here — MapLibre's worker and the chunk it imports
 * are both ES modules.
 */
const PUBLIC_ASSET_EXTENSIONS = [
  "css",
  "geojson",
  "gif",
  "ico",
  "jpeg",
  "jpg",
  "js",
  "json",
  "map",
  "mjs",
  "png",
  "svg",
  "txt",
  "webmanifest",
  "webp",
  "woff",
  "woff2",
  "xml",
] as const;

/** Static directories under `public/` that are public wholesale. */
const PUBLIC_ASSET_PREFIXES = ["/_next/static", "/_next/image", "/data/"] as const;

/**
 * True for paths the auth proxy should not touch.
 *
 * Deliberately extension- and prefix-based rather than an allowlist of files:
 * the alternative is that every asset added to `public/` is a redirect bug
 * waiting for someone to open the map. Pages have no extension and `/api/*`
 * has no extension, so neither can match by accident.
 */
export function isPublicAsset(pathname: string): boolean {
  if (PUBLIC_ASSET_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true;
  // Only the segment after the last `/` counts, so a page at `/listings/a.b`
  // cannot be exempted by something earlier in the path.
  const file = pathname.slice(pathname.lastIndexOf("/") + 1);
  const dot = file.lastIndexOf(".");
  if (dot <= 0) return false;
  // Case-sensitive, matching the regex below, which Next compiles without the
  // `i` flag. Everything in `public/` is lowercase; the parity test is worth
  // more here than tolerance for a filename we would not accept anyway.
  const ext = file.slice(dot + 1);
  return (PUBLIC_ASSET_EXTENSIONS as readonly string[]).includes(ext);
}

/**
 * The rule again, as a regex, for the test to compare against.
 *
 * It cannot be interpolated into `config.matcher` below — Next parses that
 * field statically at build time and rejects an identifier with "matcher[0]
 * need to be static strings". So the literal is written twice on purpose, and
 * `src/proxy.test.ts` asserts the two copies (and `isPublicAsset`) still say
 * the same thing.
 */
export const PUBLIC_ASSET_MATCHER =
  "/((?!_next/static|_next/image|data/|.*\\.(?:css|geojson|gif|ico|jpeg|jpg|js|json|map|mjs|png|svg|txt|webmanifest|webp|woff|woff2|xml)$).*)";

export const config = {
  matcher: [
    // Keep in sync with `PUBLIC_ASSET_MATCHER` above. Must stay a literal.
    "/((?!_next/static|_next/image|data/|.*\\.(?:css|geojson|gif|ico|jpeg|jpg|js|json|map|mjs|png|svg|txt|webmanifest|webp|woff|woff2|xml)$).*)",
  ],
};
