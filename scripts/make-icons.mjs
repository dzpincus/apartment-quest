/**
 * Generates the PWA icons in `public/` from one inline SVG.
 *
 * A one-off: run it, commit the PNGs, forget it. It is checked in rather than
 * wired into `build` because the icons never change and a build step that
 * shells out to libvips to redraw the same three files every deploy is a build
 * step that will one day fail on a machine without them.
 *
 *   node scripts/make-icons.mjs
 *
 * The mark is a house in the app's ink (`#1a1836`) on the primary yellow
 * (`#ffd56b`) — the two colours the design system already has. Paths, not
 * text: sharp renders SVG through libvips, whose font support depends on what
 * fontconfig can find, and an icon that says "AQ" on a laptop and nothing at
 * all on a CI runner is worse than no letters.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const PRIMARY = "#ffd56b";
const INK = "#1a1836";

/** 512-unit square: a rounded tile, a roof, a body, and a door punched out. */
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" ry="112" fill="${PRIMARY}"/>
  <path d="M256 104 L424 252 L392 252 L392 408 A16 16 0 0 1 376 424 L136 424 A16 16 0 0 1 120 408 L120 252 L88 252 Z" fill="${INK}"/>
  <rect x="222" y="316" width="68" height="108" rx="10" fill="${PRIMARY}"/>
  <rect x="150" y="286" width="56" height="56" rx="10" fill="${PRIMARY}"/>
  <rect x="306" y="286" width="56" height="56" rx="10" fill="${PRIMARY}"/>
</svg>`;

const OUT = path.join(fileURLToPath(new URL("../public", import.meta.url)));

/**
 * Only the two the manifest names. iOS's icon is `src/app/apple-icon.tsx`
 * (Next's file convention, 180px, and the app's own 💩 mark) — writing an
 * `apple-touch-icon.png` here as well would put two `rel="apple-touch-icon"`
 * links in the head and leave the choice to tag order.
 */
const SIZES = [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
];

await mkdir(OUT, { recursive: true });

for (const [name, size] of SIZES) {
  const png = await sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
  await writeFile(path.join(OUT, name), png);
  console.info(`[icons] ${name} (${size}px, ${png.length} bytes)`);
}
