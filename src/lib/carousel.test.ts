import { describe, expect, it } from "vitest";
import { nextIndex, prevIndex, slidesToRender } from "./carousel";

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
