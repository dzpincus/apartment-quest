/**
 * The three decisions the photo carousel makes, kept out of the component so
 * they can be tested without a DOM.
 *
 * The component is a scroll container with some absolutely positioned
 * chrome — nothing about *that* is worth a test. What is worth a test is the
 * arithmetic: an arrow that walks off the end of the array, and the rule that
 * decides how many `<img>` tags a card is allowed to create before anybody has
 * touched it. Sixty cards × eight photos is 480 requests on a page nobody has
 * scrolled yet, which is the whole reason `armed` exists.
 */

/**
 * The next slide, clamped rather than wrapped.
 *
 * The lightbox wraps on purpose — a flick of the thumb at photo nine should
 * not dead-end — but a card does not: the arrow that would wrap is hidden, and
 * a scroll container cannot animate from its right edge back to its left
 * without looking like a bug. Out-of-range input clamps too, because the index
 * comes from a scroll position and a rubber-banding iOS scroll can report one.
 */
export function nextIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, Math.trunc(index)) + 1);
}

/** `nextIndex` backwards: clamped at zero, never negative. */
export function prevIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return Math.max(0, Math.min(count - 1, Math.trunc(index)) - 1);
}

/**
 * Which slides may render a real `<img>` — the lazy strategy in one function.
 *
 * Unarmed, that is slide 0 and nothing else: a list of cards costs one request
 * per card, the same as the 64px thumbnail it replaced. The first touch,
 * arrow click or arrow key arms the carousel and every slide becomes real at
 * once, so the wait is felt one time instead of once per swipe.
 *
 * Returns indices rather than a count so the caller reads as
 * `live.has(i)` — a `Set` lookup per slide, no off-by-one at the call site.
 */
export function slidesToRender(armed: boolean, count: number): number[] {
  const total = Math.max(0, Math.trunc(count));
  if (total === 0) return [];
  if (!armed) return [0];
  return Array.from({ length: total }, (_, i) => i);
}

/**
 * The three photos the lightbox keeps mounted: the one on screen and its two
 * neighbours.
 *
 * Stepping is then a swap between `<img>` tags the browser has already
 * decoded, rather than a fresh request with a blank stage in the middle of it.
 * Clamped rather than wrapped, and de-duplicated by construction: at the first
 * or last photo this is two indices, not three with a repeat, because the
 * caller keys React elements off them and a repeated key is a warning at best.
 *
 * The lightbox's *stepping* still wraps — that is `(i + delta + n) % n` in the
 * component. This is only the mounting window; the far end of a wrap is
 * covered by `prefetchPhotos`, which warmed the whole set when the viewer
 * opened.
 */
export function visibleIndices(current: number, count: number): number[] {
  const total = Math.max(0, Math.trunc(count));
  if (total === 0) return [];
  // A non-finite index comes from arithmetic on an empty set somewhere
  // upstream; showing the first photo beats rendering nothing at all.
  const raw = Number.isFinite(current) ? Math.trunc(current) : 0;
  const at = Math.max(0, Math.min(total - 1, raw));
  return [at - 1, at, at + 1].filter((i) => i >= 0 && i < total);
}
