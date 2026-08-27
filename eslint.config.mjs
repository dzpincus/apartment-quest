import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // MapLibre's worker bundle, copied verbatim into `public/` by
    // `scripts/copy-maplibre-worker.mjs`. Vendored and minified: linting it
    // buries our own findings under a thousand warnings about someone else's
    // build output.
    "public/maplibre-gl-*.mjs",
  ]),
]);

export default eslintConfig;
