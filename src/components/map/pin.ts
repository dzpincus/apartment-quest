/**
 * The things stuck on the map, as DOM.
 *
 * MapLibre's `Marker` takes an `HTMLElement`, not a React node, and sixty pins
 * is nowhere near the point where symbol layers (a GeoJSON source, an icon
 * sprite, two `queryRenderedFeatures` handlers) would pay for themselves. So
 * these are plain builders: one element per pin, mutated in place when the
 * selection changes rather than torn down and rebuilt.
 *
 * Colours are the Dusk Candy hexes rather than Tailwind classes on purpose —
 * these nodes live inside MapLibre's marker container, which is outside the
 * React tree, and a person's colour is data (`people.color`) that arrives as an
 * inline style everywhere else in the app too.
 */

const INK = "#1a1836";
const PAGE = "#1a1836";
const FOREGROUND = "#f2efff";
const PRIMARY = "#ffd56b";

export type ListingPinState = {
  /** Off-market or removed: still on the map, quieter (`gone?` in the table). */
  dimmed?: boolean;
  selected?: boolean;
};

export type ListingPinOptions = ListingPinState & {
  /** `$5.2k`, already formatted by `moneyShort`. */
  label: string;
  /** Whoever found it — `people.color`, never a literal. */
  color: string;
  /** What a screen reader says: address, rent, state. */
  ariaLabel: string;
};

/**
 * A listing: a dot in the finder's colour with the rent beside it, on a pill
 * dark enough to stay legible over water, parkland and a lit-up avenue.
 *
 * A `<button>` rather than a `<div role="button">` so it is tabbable, has a
 * focus ring and answers Enter without any of that being reimplemented.
 */
export function listingPinElement(options: ListingPinOptions): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "aq-pin";
  el.setAttribute("aria-label", options.ariaLabel);

  const dot = document.createElement("span");
  dot.className = "aq-pin-dot";
  dot.style.backgroundColor = options.color;
  dot.setAttribute("aria-hidden", "true");

  const text = document.createElement("span");
  text.className = "aq-pin-label";
  text.textContent = options.label;

  el.append(dot, text);
  el.style.borderColor = options.color;
  applyListingPinState(el, options);
  return el;
}

/**
 * Selection and the `gone?` dimming, applied to an existing pin. Cheap enough
 * to call for every pin on every selection change, which is what keeps the
 * markers (and therefore the map's DOM) stable while a person taps around.
 */
export function applyListingPinState(el: HTMLElement, state: ListingPinState): void {
  el.dataset.selected = state.selected ? "true" : "false";
  el.dataset.dimmed = state.dimmed ? "true" : "false";
  el.style.zIndex = state.selected ? "3" : state.dimmed ? "1" : "2";
  el.setAttribute("aria-pressed", state.selected ? "true" : "false");
}

/**
 * A saved place: its emoji, or a star when nobody picked one. Primary yellow,
 * because a location is not a person and must never borrow a person's colour.
 */
export function locationPinElement(options: {
  emoji?: string | null;
  name: string;
  /** The starred place gets a ring, so "measure to here" is visible at a glance. */
  primary?: boolean;
}): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "aq-location-pin";
  el.title = options.name;
  el.setAttribute("role", "img");
  el.setAttribute(
    "aria-label",
    `${options.name}${options.primary ? " (starred place)" : ""}`,
  );
  el.textContent = options.emoji?.trim() || "★";
  el.style.color = options.emoji?.trim() ? FOREGROUND : PRIMARY;
  el.style.borderColor = options.primary ? PRIMARY : "rgba(255,213,107,0.45)";
  el.style.boxShadow = options.primary ? `0 0 0 3px rgba(255,213,107,0.25)` : "none";
  return el;
}

/**
 * The one place the pins' CSS lives. Injected as a `<style>` element the first
 * time a map mounts rather than sitting in `globals.css`: nothing on the
 * listings page needs a rule about `.aq-pin` until the map chunk has actually
 * been fetched, and this file is inside that chunk.
 *
 * The map's own controls are restyled here too — MapLibre ships a white
 * attribution bar, which must stay visible (licence) but does not have to
 * glow.
 */
export const MAP_CSS = `
.aq-pin {
  display: inline-flex; align-items: center; gap: 5px;
  height: 26px; padding: 0 9px 0 7px;
  border: 2px solid ${PRIMARY}; border-radius: 999px;
  background: rgba(26,24,54,0.92); color: ${FOREGROUND};
  font-family: inherit; font-size: 12px; font-weight: 800; line-height: 1;
  white-space: nowrap; cursor: pointer;
  transition: transform 120ms ease, opacity 120ms ease;
  transform-origin: center;
}
.aq-pin:focus-visible { outline: 3px solid ${PRIMARY}; outline-offset: 2px; }
.aq-pin[data-dimmed="true"] { opacity: 0.45; }
.aq-pin[data-selected="true"] {
  transform: scale(1.22);
  background: ${PAGE};
  box-shadow: 0 4px 0 rgba(0,0,0,0.35);
}
.aq-pin-dot { width: 9px; height: 9px; border-radius: 999px; flex: none; }
.aq-pin-label { pointer-events: none; }

.aq-location-pin {
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border-radius: 999px;
  border: 2px solid ${PRIMARY}; background: rgba(26,24,54,0.92);
  font-size: 14px; line-height: 1;
}

.aq-map .maplibregl-ctrl-attrib,
.aq-map .maplibregl-ctrl-attrib a {
  background: rgba(26,24,54,0.82); color: #b3aee0;
  font-family: inherit; font-size: 10px;
}
.aq-map .maplibregl-ctrl-attrib { border-radius: 999px 0 0 0; padding: 1px 6px; }
.aq-map .maplibregl-ctrl-attrib a { text-decoration: underline; }
.aq-map .maplibregl-ctrl-attrib-button { background-color: rgba(26,24,54,0.82); filter: invert(1); }
.aq-map .maplibregl-ctrl-group { background: ${INK}; border: 1px solid #3c3778; }
.aq-map .maplibregl-ctrl-group button + button { border-top: 1px solid #3c3778; }
.aq-map .maplibregl-ctrl-group button span { filter: invert(1); }
.aq-map .maplibregl-canvas { outline: none; }
.aq-map .maplibregl-cooperative-gesture-screen { font-size: 0.85rem; font-weight: 700; background: rgba(26,24,54,0.7); }
`;

const STYLE_ID = "aq-map-css";

/** Idempotent: two maps on one page share the one `<style>` tag. */
export function ensureMapCss(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const tag = document.createElement("style");
  tag.id = STYLE_ID;
  tag.textContent = MAP_CSS;
  document.head.append(tag);
}
