/**
 * MapLibre, with its worker URL spelled out.
 *
 * Every map in the app imports `maplibre-gl` through this module rather than
 * directly, because MapLibre cannot work out where its own worker lives in a
 * Turbopack build and the failure is remote from the cause.
 *
 * v6 derives the worker URL from `import.meta.url` and bails to the empty
 * string when that does not look like a network URL:
 *
 *     let e = import.meta.url;
 *     if (!/^https?:/.test(e)) return ``;
 *
 * Turbopack compiles `import.meta.url` to a `file://` path into
 * `node_modules`, so the guard rejects it and MapLibre ends up calling
 * `new Worker("", { type: "module" })`. An empty URL resolves against the
 * document, which means the browser requests the current *page* as a module
 * script — on `/listings` that is a proxy redirect to the login HTML, and
 * Chrome refuses it with "non-JavaScript MIME type of text/html". The map
 * silently never draws.
 *
 * `setWorkerUrl` removes the derivation from the picture. The file it points
 * at is copied into `public/` by `scripts/copy-maplibre-worker.mjs` and must
 * stay outside the auth proxy's matcher (see `src/proxy.ts`): a worker fetch
 * that gets a 307 to a login page is exactly the bug above, wearing a
 * different hat.
 */

import { getWorkerUrl, setWorkerUrl } from "maplibre-gl";

/**
 * Same-origin and absolute. Same-origin matters: MapLibre only takes the
 * straight `new Worker(url)` path when the URL matches `location.origin` —
 * a cross-origin URL sends it through a fetch-and-blob shim that a CDN would
 * have to serve permissive CORS headers for.
 *
 * `public/maplibre-gl-worker.mjs` relative-imports `./maplibre-gl-shared.mjs`,
 * which is why both sit at the web root.
 */
export const MAPLIBRE_WORKER_URL = "/maplibre-gl-worker.mjs";

/**
 * Setting this after a `Map` has been constructed would leave the first map
 * with the broken worker, so it happens at module scope: any importer has run
 * this before its own body, and maps are only ever built later, inside
 * effects. Guarded so a second import is a no-op rather than a reassignment.
 */
if (!getWorkerUrl()) {
  setWorkerUrl(MAPLIBRE_WORKER_URL);
}

export { LngLatBounds, Map as MapLibreMap, Marker } from "maplibre-gl";
export type { MapOptions } from "maplibre-gl";
