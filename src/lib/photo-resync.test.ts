/**
 * "Which of these have we not got?" — the only decision a photo re-sync makes,
 * and the one that has to be right, because getting it wrong is either a
 * duplicated gallery or a refresh that can never find anything.
 */

import { describe, expect, it } from "vitest";
import { MAX_NEW_PHOTOS_PER_RUN, pickNewPhotos } from "./photo-resync";

const zillow = (hash: string, variant = "cc_ft_768") =>
  `https://photos.zillowstatic.com/fp/${hash}-${variant}.jpg`;

describe("pickNewPhotos", () => {
  it("takes everything when the listing has no photos yet", () => {
    const candidates = [zillow("a"), zillow("b"), zillow("c")];
    expect(pickNewPhotos(candidates, [])).toEqual({
      picked: candidates,
      skippedExisting: 0,
      overCap: 0,
    });
  });

  it("skips a photo we already hold, whichever rendition the page offers", () => {
    const result = pickNewPhotos(
      [zillow("a", "cc_ft_1536"), zillow("b"), zillow("c", "p_d")],
      [zillow("a", "cc_ft_384"), zillow("c", "uncropped_scaled_within_1536_1152")],
    );
    expect(result.picked).toEqual([zillow("b")]);
    expect(result.skippedExisting).toBe(2);
  });

  it("ignores a manual upload's null source_url", () => {
    // Three photos off a phone are not evidence about anything on the page.
    const result = pickNewPhotos([zillow("a")], [null, undefined, null]);
    expect(result.picked).toEqual([zillow("a")]);
    expect(result.skippedExisting).toBe(0);
  });

  it("counts two renditions of one new photo as one photo", () => {
    const result = pickNewPhotos([zillow("a", "cc_ft_384"), zillow("a", "cc_ft_1536")], []);
    expect(result.picked).toEqual([zillow("a", "cc_ft_384")]);
    expect(result.skippedExisting).toBe(1);
    expect(result.overCap).toBe(0);
  });

  it("stops at the cap and counts the rest as deferred, not as duplicates", () => {
    const candidates = Array.from({ length: 5 }, (_, i) => zillow(`h${i}`));
    const result = pickNewPhotos(candidates, [], 2);
    expect(result.picked).toEqual([zillow("h0"), zillow("h1")]);
    expect(result.overCap).toBe(3);
    expect(result.skippedExisting).toBe(0);
  });

  it("counts a candidate it cannot key as skipped rather than as new", () => {
    // Otherwise it is re-attempted, and re-fails, on every single run.
    const result = pickNewPhotos(["data:image/png;base64,x", "not a url", zillow("a")], []);
    expect(result.picked).toEqual([zillow("a")]);
    expect(result.skippedExisting).toBe(2);
  });

  it("always accounts for every candidate", () => {
    // The three counters are the toast's sentence; an answer that does not add
    // up is a bug report from the person reading it.
    const candidates = [
      zillow("a"),
      zillow("a", "cc_ft_384"),
      "https://photos.streeteasy.com/x/i-1-large.jpg",
      "https://photos.streeteasy.com/y/i-1-small.jpg",
      "https://cdn.example.com/new.jpg?w=1",
      "nonsense",
    ];
    const result = pickNewPhotos(candidates, ["https://cdn.example.com/new.jpg"], 1);
    expect(
      result.picked.length + result.skippedExisting + result.overCap,
    ).toBe(candidates.length);
  });

  it("defaults to a dozen per run", () => {
    const candidates = Array.from({ length: 20 }, (_, i) => zillow(`h${i}`));
    expect(pickNewPhotos(candidates, []).picked).toHaveLength(MAX_NEW_PHOTOS_PER_RUN);
  });
});
