/**
 * Copies MapLibre's worker bundle into `public/` so it can be served from our
 * own origin at a URL we choose.
 *
 * Why this exists: maplibre-gl v6 finds its own worker by reading
 * `import.meta.url` and only trusts the result if it looks like a real network
 * URL —
 *
 *     let e = import.meta.url;
 *     if (!/^https?:/.test(e)) return ``;
 *
 * Under Turbopack, `import.meta.url` compiles to a `file://` path pointing at
 * the module inside `node_modules` (Turbopack's `resolveFileUrl` helper), so
 * the test fails, the derivation returns the empty string, and MapLibre calls
 * `new Worker("", { type: "module" })`. An empty worker URL resolves against
 * the document, so the browser asks the *page* for a module script, the auth
 * proxy answers with the login HTML, and Chrome reports:
 *
 *     Failed to load module script: The server responded with a
 *     non-JavaScript MIME type of "text/html".
 *
 * `setWorkerUrl()` in `src/components/map/maplibre.ts` takes the guesswork
 * away by naming the file outright. This script is what puts the file there.
 *
 * Note there is no `maplibre-gl-csp-worker.js` in v6 — the CSP build was
 * dropped. The worker is now an ES module that does a *relative* import of
 * `./maplibre-gl-shared.mjs`, so both files have to land side by side in
 * `public/` or the worker will 404 on its own dependency.
 *
 * Runs on `postinstall` (so it tracks the installed version) and on
 * `prebuild` (so a CI install that skipped scripts still gets it). The copies
 * are committed as well, so a fresh clone works without either hook.
 */

import { createRequire } from "node:module";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = join(root, "public");

/**
 * The worker plus the chunk it imports. Order matters only for the log.
 * If MapLibre ever splits the worker further this list needs to grow, which
 * the sanity check below is meant to catch loudly rather than at runtime.
 */
const FILES = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

const distDir = dirname(require.resolve("maplibre-gl/dist/maplibre-gl.mjs"));
const version = JSON.parse(
  await readFile(require.resolve("maplibre-gl/package.json"), "utf8"),
).version;

await mkdir(publicDir, { recursive: true });

for (const name of FILES) {
  await copyFile(join(distDir, name), join(publicDir, name));
}

/**
 * The worker's imports must all be files we actually copied. A bare specifier
 * or an unknown relative path would resolve against `/` in the browser and
 * 404, and the only symptom would be a map that never renders tiles — so it
 * is worth failing the build here instead.
 */
const workerSource = await readFile(join(publicDir, FILES[0]), "utf8");
const imports = [...workerSource.matchAll(/from\s*["'`]([^"'`]+)["'`]/g)].map((m) => m[1]);
const unmet = imports.filter((spec) => !FILES.includes(spec.replace(/^\.\//, "")));
if (unmet.length > 0) {
  console.error(
    `[maplibre] worker imports files that were not copied: ${unmet.join(", ")}\n` +
      `[maplibre] add them to FILES in scripts/copy-maplibre-worker.mjs`,
  );
  process.exit(1);
}

console.log(`[maplibre] copied worker for v${version} -> public/${FILES.join(", public/")}`);
