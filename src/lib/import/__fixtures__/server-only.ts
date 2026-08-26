/**
 * Vitest stand-in for the `server-only` package.
 *
 * The real module throws on import outside a server bundle, which is exactly
 * what we want in the app and exactly what stops a unit test from reaching the
 * SSRF guard in `fetch-page.ts`. Aliased in `vitest.config.mts`.
 *
 * This does NOT weaken the guarantee: the check that matters happens at build
 * time (`next build` fails if a client component pulls in `server-only`), and
 * the alias exists only inside the test runner.
 */
export {};
