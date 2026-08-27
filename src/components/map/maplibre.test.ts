/**
 * Guards the one rule that keeps the map's worker loadable.
 *
 * `maplibre.ts` calls `setWorkerUrl` at module scope, which fixes MapLibre's
 * global config — but only if that module is actually evaluated. A new map
 * component that imports `maplibre-gl` directly would work fine on any route
 * where an existing map had already been loaded, and fail only on a route
 * where it is the first map on the page. That is a bug that reproduces for
 * users and not for whoever wrote it, so it is checked statically instead.
 *
 * Reading source rather than importing: `maplibre-gl` needs a DOM and a
 * WebGL context, and this suite runs in node.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "..");

/** Every `.ts`/`.tsx` under `src/`, tests included. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe("maplibre module chokepoint", () => {
  it("is the only module importing maplibre-gl directly", () => {
    const offenders = sourceFiles(src)
      .filter((file) => file !== join(here, "maplibre.ts"))
      .filter((file) => /from\s*["']maplibre-gl["']/.test(readFileSync(file, "utf8")))
      .map((file) => file.slice(src.length + 1));

    expect(
      offenders,
      "import from '@/components/map/maplibre' instead — it sets the worker URL",
    ).toEqual([]);
  });

  it("sets the worker URL to a same-origin absolute path", () => {
    const source = readFileSync(join(here, "maplibre.ts"), "utf8");
    expect(source).toContain("setWorkerUrl");
    // Relative would resolve against the *page*, which is the bug this whole
    // module exists to avoid. Cross-origin would send MapLibre down its
    // fetch-and-blob path instead of `new Worker(url)`.
    expect(source).toMatch(/MAPLIBRE_WORKER_URL\s*=\s*"\/maplibre-gl-worker\.mjs"/);
  });

  it("points at a file that is committed to public/", () => {
    const publicDir = join(src, "..", "public");
    const present = readdirSync(publicDir);
    // Both, not just the entry: the worker relative-imports the shared chunk.
    expect(present).toContain("maplibre-gl-worker.mjs");
    expect(present).toContain("maplibre-gl-shared.mjs");
  });
});
