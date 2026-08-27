import { describe, expect, it } from "vitest";
import { nextIndex, prevIndex, slidesToRender, visibleIndices } from "./carousel";

/**
 * The card carousel is a scroll container with chrome on top, and the only
 * parts of it that can be *wrong* rather than ugly are these three: an arrow
 * that walks past the end of the array, and the rule that decides how many
 * requests a resting list of cards is allowed to make.
 */

describe("nextIndex / prevIndex", () => {
  it("steps through the middle of a set", () => {
    expect(nextIndex(0, 8)).toBe(1);
    expect(nextIndex(6, 8)).toBe(7);
    expect(prevIndex(7, 8)).toBe(6);
    expect(prevIndex(1, 8)).toBe(0);
  });

  it("clamps rather than wraps — a card is not the lightbox", () => {
    // The lightbox wraps on purpose; a scroll container cannot animate from
    // its right edge to its left without looking broken, and the arrow that
    // would do it is hidden anyway.
    expect(nextIndex(7, 8)).toBe(7);
    expect(prevIndex(0, 8)).toBe(0);
  });

  it("clamps input that came from a rubber-banding scroll", () => {
    // The index is derived from `scrollLeft / clientWidth`, and iOS reports a
    // negative one at the left edge and an over-long one at the right.
    expect(nextIndex(-3, 8)).toBe(1);
    expect(prevIndex(-3, 8)).toBe(0);
    expect(nextIndex(99, 8)).toBe(7);
    expect(prevIndex(99, 8)).toBe(6);
    expect(nextIndex(2.6, 8)).toBe(3);
    expect(prevIndex(2.6, 8)).toBe(1);
  });

  it("is 0 for a single photo and for none at all", () => {
    expect(nextIndex(0, 1)).toBe(0);
    expect(prevIndex(0, 1)).toBe(0);
    expect(nextIndex(0, 0)).toBe(0);
    expect(prevIndex(4, 0)).toBe(0);
  });
});

describe("slidesToRender", () => {
  it("renders only the first slide until something arms it", () => {
    // Sixty cards × eight photos on a page nobody has scrolled is the whole
    // reason this function exists.
    expect(slidesToRender(false, 8)).toEqual([0]);
  });

  it("renders the whole set once armed", () => {
    expect(slidesToRender(true, 4)).toEqual([0, 1, 2, 3]);
  });

  it("has nothing to render with no photos, armed or not", () => {
    expect(slidesToRender(false, 0)).toEqual([]);
    expect(slidesToRender(true, 0)).toEqual([]);
    expect(slidesToRender(true, -2)).toEqual([]);
  });

  it("is the same list either way for a single photo", () => {
    expect(slidesToRender(false, 1)).toEqual([0]);
    expect(slidesToRender(true, 1)).toEqual([0]);
  });
});

describe("visibleIndices", () => {
  it("keeps the current photo and both neighbours mounted", () => {
    expect(visibleIndices(4, 9)).toEqual([3, 4, 5]);
  });

  it("drops the neighbour that does not exist at either end", () => {
    // Clamped, not wrapped: photo 0 has no previous, so the window is two
    // wide rather than three with index 0 repeated — the caller keys React
    // elements off these.
    expect(visibleIndices(0, 9)).toEqual([0, 1]);
    expect(visibleIndices(8, 9)).toEqual([7, 8]);
  });

  it("is the single photo when that is all there is", () => {
    expect(visibleIndices(0, 1)).toEqual([0]);
    expect(visibleIndices(3, 1)).toEqual([0]);
  });

  it("has nothing to mount with no photos", () => {
    expect(visibleIndices(0, 0)).toEqual([]);
    expect(visibleIndices(2, -4)).toEqual([]);
  });

  it("clamps an index that walked off the array", () => {
    expect(visibleIndices(99, 5)).toEqual([3, 4]);
    expect(visibleIndices(-7, 5)).toEqual([0, 1]);
    expect(visibleIndices(2.7, 5)).toEqual([1, 2, 3]);
    expect(visibleIndices(Number.NaN, 5)).toEqual([0, 1]);
  });

  it("never returns a duplicate index", () => {
    for (const count of [1, 2, 3, 8]) {
      for (let i = 0; i < count; i++) {
        const window = visibleIndices(i, count);
        expect(new Set(window).size).toBe(window.length);
        expect(window).toContain(i);
      }
    }
  });
});
