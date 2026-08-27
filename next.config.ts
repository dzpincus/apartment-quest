import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Four headers that cost nothing and close four defaults.
   *
   * `X-Frame-Options: DENY` — nothing in this app is meant to be embedded, and
   * the one shared login means a framed page is a session someone else's site
   * can click through.
   * `X-Content-Type-Options: nosniff` — the vendored MapLibre workers are
   * served out of `public/`, and a sniffed MIME type on a `.mjs` is the exact
   * failure `src/proxy.ts`'s asset matcher already exists to avoid.
   * `Referrer-Policy: strict-origin-when-cross-origin` — listing URLs are typed
   * in by people and paths can carry an address; cross-origin requests
   * (tiles, listing photos) get the origin and not the path.
   * `Permissions-Policy` — the app asks for no camera, microphone or
   * geolocation. The map centres on New York, not on you.
   *
   * **Deliberately no Content-Security-Policy.** MapLibre creates workers from
   * blob URLs, the recoloured style is fetched from a third-party origin at
   * runtime, imported photos come from arbitrary listing CDNs, and both Next
   * and MapLibre inject inline styles — so a CSP tight enough to be worth
   * having is one bad directive away from a blank map or a blank page, with no
   * test that would catch it. It wants its own change with a report-only
   * rollout, not a line added here.
   */
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
