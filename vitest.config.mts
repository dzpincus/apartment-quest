import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Lets the SSRF guard in `src/lib/import/fetch-page.ts` be unit-tested.
      // See the stub for why this is safe.
      "server-only": fileURLToPath(
        new URL("./src/lib/import/__fixtures__/server-only.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
