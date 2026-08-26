import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { discoverPhotos, largestFromSrcset, PHOTO_CAP } from "./photos";

const fixture = (name: string) =>
  readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8");

const ZILLOW = fixture("zillow-like.html");
const ZILLOW_REAL = fixture("zillow-real-head.html");
const STREETEASY = fixture("streeteasy-like.html");
const PASTE = fixture("paste.txt");

/** The five photos in `zillow-real-head.html`, in the order the page shows them. */
const HASH = {
  hero: "4270c620da02f7e50b2bf466c427f437",
  living: "d8a05a1ced32db10c35e36f1b853d1e0",
  kitchen: "a178a16cadfb7859c4f65695c1c21d39",
  small: "7f97d91efa9ecc49a6286471dc3b587c",
  noWide: "19022e5380d671f077e8e29dc34f4746",
};

describe("discoverPhotos — a Zillow-shaped page", () => {
  const photos = discoverPhotos(ZILLOW, {
    baseUrl: "https://www.zillow.com/homedetails/214-grand-st-4b/1234_zpid/",
  });

  it("finds the eight photos in __NEXT_DATA__ and nothing else", () => {
    expect(photos).toHaveLength(8);
  });

  it("asks for the largest rendition the page actually published", () => {
    // The first photo is the `og:image`, which this page publishes at 1536.
    // The other seven exist only at 384 and 768 in `__NEXT_DATA__`, so 768 is
    // the honest answer — a 1536 URL we invented might 404.
    expect(photos[0]).toBe(
      "https://photos.zillowstatic.com/fp/p1aaaaaaaaaaaaaa-cc_ft_1536.jpg",
    );
    expect(photos.slice(1).every((url) => url.endsWith("-cc_ft_768.jpg"))).toBe(true);
    expect(photos.some((url) => url.includes("-cc_ft_384"))).toBe(false);
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

describe("discoverPhotos — a real Zillow head, where the photos are buried", () => {
  const photos = discoverPhotos(ZILLOW_REAL, {
    baseUrl:
      "https://www.zillow.com/homedetails/101-Patchen-Ave-DPX-Brooklyn-NY-11221/2054843234_zpid/",
  });

  it("returns photos, not the bundles that share the CDN host", () => {
    expect(photos.length).toBeGreaterThan(0);
    for (const url of photos) {
      expect(url).toMatch(
        /^https:\/\/photos\.zillowstatic\.com\/fp\/[0-9a-f]+-[\w.]+\.(?:jpg|webp)$/,
      );
    }
    expect(photos.some((u) => /\.(?:js|css)$/.test(u))).toBe(false);
    expect(photos.some((u) => u.includes("/s3/pfs/"))).toBe(false);
    expect(photos.some((u) => u.includes("/vrmodels/"))).toBe(false);
    expect(photos.some((u) => u.includes("pubnub"))).toBe(false);
    expect(photos.some((u) => u.includes("maps.googleapis"))).toBe(false);
    expect(photos.some((u) => /avatar|logo|noScript/i.test(u))).toBe(false);
  });

  it("never returns a bare host or a directory", () => {
    for (const url of photos) {
      expect(new URL(url).pathname).not.toMatch(/\/$/);
      expect(url).not.toBe("https://www.zillowstatic.com/");
    }
  });

  it("keeps exactly one URL per photo, not seventeen renditions of five", () => {
    expect(photos).toHaveLength(5);
    const hashes = photos.map((u) => u.match(/\/fp\/([0-9a-f]+)-/)?.[1]);
    expect(new Set(hashes).size).toBe(5);
  });

  it("prefers uncropped, then cc_ft_1536, then the widest cc_ft offered", () => {
    const chosen = (hash: string) => photos.find((u) => u.includes(hash));
    // Offered uncropped in both formats: jpg wins the tie.
    expect(chosen(HASH.hero)).toBe(
      `https://photos.zillowstatic.com/fp/${HASH.hero}-uncropped_scaled_within_1536_1152.jpg`,
    );
    // Offered uncropped in webp only: the rendition beats the format.
    expect(chosen(HASH.living)).toBe(
      `https://photos.zillowstatic.com/fp/${HASH.living}-uncropped_scaled_within_1536_1152.webp`,
    );
    // No uncropped, full ladder: 1536, and jpg over the webp beside it.
    expect(chosen(HASH.kitchen)).toBe(
      `https://photos.zillowstatic.com/fp/${HASH.kitchen}-cc_ft_1536.jpg`,
    );
    // Ladder stops at 1344 — we take that rather than invent a 1536.
    expect(chosen(HASH.noWide)).toBe(
      `https://photos.zillowstatic.com/fp/${HASH.noWide}-cc_ft_1344.jpg`,
    );
    // Only ever published small: still no invention, and still not the -p_d.
    expect(chosen(HASH.small)).toBe(
      `https://photos.zillowstatic.com/fp/${HASH.small}-cc_ft_384.jpg`,
    );
    expect(photos.some((u) => u.includes("-p_d."))).toBe(false);
  });

  it("puts the og:image first and the rest in page order", () => {
    // The gallery shows the living room before the kitchen; the JSON blob at
    // the bottom of the page lists them the other way round. The markup wins.
    expect(photos.map((u) => u.match(/\/fp\/([0-9a-f]+)-/)?.[1])).toEqual([
      HASH.hero,
      HASH.living,
      HASH.kitchen,
      HASH.small,
      HASH.noWide,
    ]);
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
