/**
 * The matcher is the whole security boundary for anything that is not an API
 * route, and it is a string literal Next reads at build time — nothing
 * type-checks it, and getting it wrong fails in two directions that both look
 * like something else.
 *
 * Too tight and a worker script gets a 307 to the login page, which Chrome
 * reports as `Failed to load module script: ... non-JavaScript MIME type of
 * "text/html"` from a stack that mentions neither the proxy nor the redirect.
 * Too loose and a page renders to a signed-out visitor.
 */

import { describe, expect, it } from "vitest";
import { config, isPublicAsset, PUBLIC_ASSET_MATCHER } from "./proxy";

/** How Next compiles a `((?!...).*)` matcher: anchored, no flags. */
const matcher = new RegExp(`^${PUBLIC_ASSET_MATCHER}$`);

/** True when the proxy would actually run for this path. */
const proxyRuns = (pathname: string) => matcher.test(pathname);

const PUBLIC = [
  "/maplibre-gl-worker.mjs",
  "/maplibre-gl-shared.mjs",
  "/data/subway-stations.geojson",
  "/data/nested/thing.json",
  "/globe.svg",
  "/vercel.svg",
  "/favicon.ico",
  "/sw.js",
  "/styles.css",
  "/chunk.js.map",
  "/fonts/inter.woff2",
  "/fonts/inter.woff",
  "/robots.txt",
  "/sitemap.xml",
  "/site.webmanifest",
  "/photo.jpg",
  "/photo.jpeg",
  "/photo.png",
  "/photo.webp",
  "/photo.gif",
  "/_next/static/chunks/abc.js",
  "/_next/image",
];

const PROTECTED = [
  "/",
  "/listings",
  "/listings/0f7c2a1e-1111-2222-3333-444455556666",
  "/brokers",
  "/chat",
  "/login",
  "/api/sync",
  "/api/geocode",
  "/api/commutes",
  "/api/import",
  "/api/photos",
];

describe("isPublicAsset", () => {
  it.each(PUBLIC)("lets %s through unproxied", (pathname) => {
    expect(isPublicAsset(pathname)).toBe(true);
  });

  it.each(PROTECTED)("keeps %s behind the proxy", (pathname) => {
    expect(isPublicAsset(pathname)).toBe(false);
  });

  it("exempts the worker and the chunk it imports", () => {
    // The worker is an ES module doing `from "./maplibre-gl-shared.mjs"`. If
    // only the entry were exempt the worker would start and then 404 on its
    // own dependency, which surfaces as a map that never paints tiles.
    expect(isPublicAsset("/maplibre-gl-worker.mjs")).toBe(true);
    expect(isPublicAsset("/maplibre-gl-shared.mjs")).toBe(true);
  });

  it("does not exempt a page because an earlier path segment has a dot", () => {
    // Only the last segment is inspected, so a route cannot be unprotected by
    // naming a parent directory `assets.js`.
    expect(isPublicAsset("/assets.js/listings")).toBe(false);
  });

  it("does not treat a dotfile as an extension", () => {
    expect(isPublicAsset("/.env")).toBe(false);
    expect(isPublicAsset("/config/.env")).toBe(false);
  });

  it("does not exempt an unknown extension", () => {
    expect(isPublicAsset("/listings/rent.5")).toBe(false);
    expect(isPublicAsset("/backup.sql")).toBe(false);
  });
});

describe("matcher regex", () => {
  it("is the one Next is configured with", () => {
    expect(config.matcher).toEqual([PUBLIC_ASSET_MATCHER]);
  });

  it.each([...PUBLIC, ...PROTECTED])("agrees with isPublicAsset for %s", (pathname) => {
    // The regex and the helper are two spellings of one rule. This is the
    // assertion that stops them drifting when a new extension is added to one
    // and forgotten in the other.
    expect(proxyRuns(pathname)).toBe(!isPublicAsset(pathname));
  });

  it("still runs the proxy for API routes", () => {
    expect(proxyRuns("/api/sync")).toBe(true);
    expect(proxyRuns("/api/import")).toBe(true);
  });

  it("skips the maplibre worker", () => {
    expect(proxyRuns("/maplibre-gl-worker.mjs")).toBe(false);
    expect(proxyRuns("/maplibre-gl-shared.mjs")).toBe(false);
  });

  it("skips the subway data", () => {
    expect(proxyRuns("/data/subway-stations.geojson")).toBe(false);
  });
});
