import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { discoverPhotos, largestFromSrcset, PHOTO_CAP } from "./photos";

const fixture = (name: string) =>
  readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");

const ZILLOW = fixture("zillow-like.html");
const STREETEASY = fixture("streeteasy-like.html");
const PASTE = fixture("paste.txt");

describe("discoverPhotos — a Zillow-shaped page", () => {
  const photos = discoverPhotos(ZILLOW, {
    baseUrl: "https://www.zillow.com/homedetails/214-grand-st-4b/1234_zpid/",
  });

  it("finds the eight photos in __NEXT_DATA__ and nothing else", () => {
    expect(photos).toHaveLength(8);
  });

  it("asks for the largest rendition, not the thumbnail it happened to find", () => {
    expect(photos.every((url) => url.includes("-cc_ft_1536.jpg"))).toBe(true);
    expect(photos.some((url) => url.includes("-cc_ft_384"))).toBe(false);
    expect(photos.some((url) => url.includes("-cc_ft_768"))).toBe(false);
  });

  it("de-duplicates the renditions of one photo", () => {
    expect(new Set(photos).size).toBe(photos.length);
    expect(photos.filter((u) => u.includes("p1aaaa"))).toHaveLength(1);
  });

  it("drops the site logo, the static map and the favicon", () => {
    expect(photos.some((u) => /logo/i.test(u))).toBe(false);
    expect(photos.some((u) => /map/i.test(u))).toBe(false);
  });

  it("preserves page order, with og:image first", () => {
    expect(photos[0]).toContain("p1aaaa");
    expect(photos[1]).toContain("p2bbbb");
    expect(photos[7]).toContain("p8hhhh");
  });
});

describe("discoverPhotos — a StreetEasy-shaped page", () => {
  const photos = discoverPhotos(STREETEASY);

  it("collects og:image, JSON-LD images and the gallery <img>s", () => {
    expect(photos).toHaveLength(5);
    expect(photos[0]).toContain("se-hero-0001");
    expect(photos.some((u) => u.includes("se-kitchen-0002"))).toBe(true);
    expect(photos.some((u) => u.includes("se-bath-0003"))).toBe(true);
    expect(photos.some((u) => u.includes("se-living-0004"))).toBe(true);
    expect(photos.some((u) => u.includes("se-bedroom-0005"))).toBe(true);
  });

  it("takes the widest srcset entry", () => {
    expect(photos.find((u) => u.includes("se-living-0004"))).toContain("-large.jpg");
    expect(photos.some((u) => u.includes("-small.jpg"))).toBe(false);
  });

  it("counts the same photo once across og, JSON-LD and srcset", () => {
    expect(photos.filter((u) => u.includes("se-hero-0001"))).toHaveLength(1);
  });

  it("drops the agent avatar", () => {
    expect(photos.some((u) => /avatar/i.test(u))).toBe(false);
  });
});

describe("discoverPhotos — limits and junk", () => {
  it("caps the list", () => {
    expect(discoverPhotos(ZILLOW, { cap: 3 })).toHaveLength(3);
    expect(PHOTO_CAP).toBe(12);
    const many = `<html><body>${Array.from(
      { length: 40 },
      (_, i) => `<img src="https://photos.example.com/nyc/shot-${i}-1200x900.jpg" width="1200">`,
    ).join("")}</body></html>`;
    expect(discoverPhotos(many)).toHaveLength(PHOTO_CAP);
  });

  it("finds nothing in pasted text, which is the point of the UI note", () => {
    expect(discoverPhotos(PASTE)).toEqual([]);
  });

  it("skips data URIs, tracking pixels and anything too small to be a photo", () => {
    const html = `
      <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" />
      <img src="https://analytics.example.com/p.gif?id=1" />
      <img src="https://photos.example.com/nyc/tiny-120.jpg" />
      <img src="https://photos.example.com/nyc/real-1200.jpg" />
      <img src="https://photos.example.com/nyc/hero.jpg?width=64" />
    `;
    expect(discoverPhotos(html)).toEqual(["https://photos.example.com/nyc/real-1200.jpg"]);
  });

  it("absolutises protocol-relative and root-relative sources", () => {
    const html = `
      <img src="//photos.example.com/nyc/a-1200.jpg" />
      <img src="/media/b-1200.jpg" />
    `;
    expect(discoverPhotos(html, { baseUrl: "https://listings.example.com/x" })).toEqual([
      "https://photos.example.com/nyc/a-1200.jpg",
      "https://listings.example.com/media/b-1200.jpg",
    ]);
  });

  it("returns nothing rather than throwing on rubbish input", () => {
    expect(discoverPhotos("")).toEqual([]);
    expect(discoverPhotos("<img src>< img")).toEqual([]);
  });
});

describe("largestFromSrcset", () => {
  it("picks the widest width descriptor", () => {
    expect(largestFromSrcset("a.jpg 320w, b.jpg 1200w, c.jpg 640w")?.url).toBe("b.jpg");
  });

  it("prefers a density descriptor over a bare entry", () => {
    expect(largestFromSrcset("a.jpg, b.jpg 2x")?.url).toBe("b.jpg");
  });

  it("falls back to the first entry when nothing is described", () => {
    expect(largestFromSrcset("a.jpg, b.jpg")?.url).toBe("a.jpg");
  });

  it("is null for an empty srcset", () => {
    expect(largestFromSrcset("")).toBeNull();
  });
});
