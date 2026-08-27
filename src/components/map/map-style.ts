/**
 * The basemap, in Dusk Candy.
 *
 * OpenFreeMap publishes five styles (`liberty`, `bright`, `positron`, `dark`,
 * `fiord`); `dark` is the one worth starting from — 47 layers, entirely
 * greyscale, no hue of its own to fight. Everything else in the app is purple,
 * so a neutral black map under yellow-and-coral pins reads as a hole in the
 * page. `duskCandy()` walks the style's `paint` blocks and re-maps every grey
 * onto the palette by *lightness*: black becomes the page (`#1a1836`), the
 * water grey becomes the inset (`#26235a`), road casings become the border
 * (`#3c3778`) and label text becomes muted foreground (`#b3aee0`).
 *
 * Doing it as a transform rather than as a hand-written style means OpenFreeMap
 * can add a layer without us shipping a 900-line JSON file that slowly rots.
 *
 * Pure except for `loadMapStyle`, which is `loadStations`' memoised fetch with
 * the same failure rule: a failed fetch drops the cache so the next caller
 * retries rather than inheriting the error forever.
 *
 * No key, no quota, no tracking — and the attribution control that ships with
 * it stays on every map (see CLAUDE.md, "Attribution is not optional").
 */

export const OPENFREEMAP_STYLE_URL = "https://tiles.openfreemap.org/styles/dark";

/**
 * The parts of a MapLibre style this module touches. Structural on purpose:
 * the real `StyleSpecification` lives in `@maplibre/maplibre-gl-style-spec`,
 * which is maplibre-gl's dependency and not ours, and a type-only import of a
 * transitive package is a build that breaks the day pnpm hoists differently.
 */
export type MapStyle = {
  version: number;
  sources: Record<string, unknown>;
  layers: MapStyleLayer[];
  [key: string]: unknown;
};

export type MapStyleLayer = {
  id: string;
  type: string;
  paint?: Record<string, unknown>;
  [key: string]: unknown;
};

export type Rgba = { r: number; g: number; b: number; a: number };

/** Page, inset, border, muted foreground — the tokens from `globals.css`. */
export const DUSK = {
  background: "#1a1836",
  water: "#26235a",
  road: "#3c3778",
  label: "#b3aee0",
  halo: "#1a1836",
} as const;

/**
 * Lightness → colour. The stops are placed where OpenFreeMap's greys actually
 * sit: `rgb(12,12,12)` background at ~0.05, water at ~0.11, `rgba(60,60,60)`
 * casings at ~0.24, `rgb(101,101,101)` place labels at ~0.40. Anything between
 * two stops is interpolated, so a layer added upstream lands somewhere sane
 * rather than being left grey.
 */
const RAMP: ReadonlyArray<readonly [number, string]> = [
  [0.0, DUSK.background],
  [0.06, "#221f4a"],
  [0.11, DUSK.water],
  [0.16, "#2e2a68"],
  [0.24, DUSK.road],
  [0.4, "#6b65a6"],
  [1.0, DUSK.label],
];

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FN_RE = /^(rgba?|hsla?)\(([^)]*)\)$/i;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/**
 * CSS colour → channels, or null for anything that is not one. Total: the
 * recolour walks every string in a `paint` block, and `"interpolate"`,
 * `"linear"` and `"zoom"` all go through here.
 */
export function parseColor(input: unknown): Rgba | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (raw === "") return null;

  const hex = HEX_RE.exec(raw);
  if (hex) {
    const digits = hex[1];
    const wide = digits.length > 4;
    const step = wide ? 2 : 1;
    const at = (i: number) => {
      const slice = digits.slice(i * step, i * step + step);
      const value = parseInt(wide ? slice : slice + slice, 16);
      return value;
    };
    const hasAlpha = digits.length === 4 || digits.length === 8;
    return { r: at(0), g: at(1), b: at(2), a: hasAlpha ? at(3) / 255 : 1 };
  }

  const fn = FN_RE.exec(raw);
  if (!fn) return null;
  // `rgb(27 ,27 ,29)` is a real string in OpenFreeMap's dark style, so the
  // split has to tolerate spaces anywhere — including the modern space-and-
  // slash syntax, `rgb(27 27 29 / 0.5)`.
  const parts = fn[2]
    .replace(/\//g, " ")
    .split(/[\s,]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 3) return null;

  const alpha = parts.length > 3 ? Number(parts[3].replace("%", "")) : 1;
  const a = Number.isFinite(alpha)
    ? clamp(parts[3]?.includes("%") ? alpha / 100 : alpha, 0, 1)
    : 1;

  if (fn[1].toLowerCase().startsWith("rgb")) {
    const [r, g, b] = parts.slice(0, 3).map((p) => {
      const n = Number(p.replace("%", ""));
      if (!Number.isFinite(n)) return NaN;
      return p.includes("%") ? (n / 100) * 255 : n;
    });
    if ([r, g, b].some((n) => !Number.isFinite(n))) return null;
    return { r: clamp(r, 0, 255), g: clamp(g, 0, 255), b: clamp(b, 0, 255), a };
  }

  const h = Number(parts[0]);
  const s = Number(parts[1].replace("%", "")) / 100;
  const l = Number(parts[2].replace("%", "")) / 100;
  if (![h, s, l].every(Number.isFinite)) return null;
  return { ...hslToRgb(h, clamp(s, 0, 1), clamp(l, 0, 1)), a };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] =
    hp < 1
      ? [c, x, 0]
      : hp < 2
        ? [x, c, 0]
        : hp < 3
          ? [0, c, x]
          : hp < 4
            ? [0, x, c]
            : hp < 5
              ? [x, 0, c]
              : [c, 0, x];
  const m = l - c / 2;
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
}

/** Rec. 709 luma, 0–1. Every colour in the source style is grey, so this is
 *  just "how bright is it" — the one axis worth preserving. */
export function lightness(color: Rgba): number {
  return (0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b) / 255;
}

function toCss(color: Rgba): string {
  const hex = [color.r, color.g, color.b]
    .map((n) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, "0"))
    .join("");
  if (color.a >= 1) return `#${hex}`;
  return `rgba(${Math.round(color.r)},${Math.round(color.g)},${Math.round(color.b)},${Number(color.a.toFixed(3))})`;
}

function rampAt(l: number): Rgba {
  const target = clamp(l, 0, 1);
  let lo = RAMP[0];
  let hi = RAMP[RAMP.length - 1];
  for (let i = 0; i < RAMP.length - 1; i += 1) {
    if (target >= RAMP[i][0] && target <= RAMP[i + 1][0]) {
      lo = RAMP[i];
      hi = RAMP[i + 1];
      break;
    }
  }
  const span = hi[0] - lo[0];
  const t = span === 0 ? 0 : (target - lo[0]) / span;
  const a = parseColor(lo[1])!;
  const b = parseColor(hi[1])!;
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
    a: 1,
  };
}

/**
 * One colour, re-mapped. Alpha survives — the motorway casings are
 * `rgba(60,60,60,0.8)` and dropping the 0.8 turns a hairline into a wall.
 * Anything that is not a colour comes back untouched.
 */
export function duskCandyColor(input: string): string {
  const parsed = parseColor(input);
  if (!parsed) return input;
  const mapped = rampAt(lightness(parsed));
  return toCss({ ...mapped, a: parsed.a });
}

/** Recolour a value that may be a plain string or a whole style expression. */
function recolorValue(value: unknown): unknown {
  if (typeof value === "string") return duskCandyColor(value);
  if (Array.isArray(value)) return value.map(recolorValue);
  return value;
}

const isColorProp = (key: string) => key.endsWith("-color");

/**
 * The whole style, in the palette. Only `paint` blocks are walked: `layout`
 * holds text fields and font names, and a font called `#000` is not a thing
 * anybody wants recoloured.
 *
 * Three layer families are pinned rather than ramped, because they carry
 * meaning the ramp would flatten: the background is the page, water is the
 * inset panel, and label text is muted foreground on a page-coloured halo —
 * OpenFreeMap's own labels are near-black on grey, which is unreadable the
 * moment the land under them stops being white.
 */
export function duskCandy(style: MapStyle): MapStyle {
  const layers = style.layers.map((layer) => {
    const paint = { ...(layer.paint ?? {}) };
    for (const [key, value] of Object.entries(paint)) {
      if (isColorProp(key)) paint[key] = recolorValue(value);
    }

    if (layer.type === "background") paint["background-color"] = DUSK.background;
    if (/water/.test(layer.id)) {
      if ("fill-color" in paint) paint["fill-color"] = DUSK.water;
      if ("line-color" in paint) paint["line-color"] = DUSK.water;
    }
    if (layer.type === "symbol") {
      if ("text-color" in paint) paint["text-color"] = DUSK.label;
      if ("text-halo-color" in paint) paint["text-halo-color"] = DUSK.halo;
    }

    return Object.keys(paint).length > 0 ? { ...layer, paint } : { ...layer };
  });

  return { ...style, layers };
}

let cache: Promise<MapStyle> | null = null;

/**
 * The style, fetched once per session and shared by every map on the page —
 * the listings map and the detail card's mini map ask at the same moment and
 * get one request. A failure clears the cache so the next map retries.
 */
export function loadMapStyle(
  fetchImpl: typeof fetch = fetch,
  url: string = OPENFREEMAP_STYLE_URL,
): Promise<MapStyle> {
  cache ??= fetchImpl(url)
    .then((res) => {
      if (!res.ok) throw new Error(`map style: ${res.status}`);
      return res.json() as Promise<MapStyle>;
    })
    .then(duskCandy)
    .catch((error) => {
      cache = null;
      throw error;
    });
  return cache;
}

/** Test seam — drops the memoised promise. */
export function resetMapStyleCache(): void {
  cache = null;
}
