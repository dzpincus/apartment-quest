/**
 * The dedupe rule for a photo re-sync, which is the whole difference between
 * "picked up the three the broker added on Tuesday" and "uploaded the gallery
 * a second time". Every case here is a URL shape one of the two sites we
 * actually import from really serves.
 */

import { describe, expect, it } from "vitest";
import { photoSourceKey } from "./photo-key";

describe("photoSourceKey — Zillow", () => {
  const HASH = "abc123def456";
  const variants = [
    `https://photos.zillowstatic.com/fp/${HASH}-cc_ft_384.jpg`,
    `https://photos.zillowstatic.com/fp/${HASH}-cc_ft_1536.jpg`,
    `https://photos.zillowstatic.com/fp/${HASH}-cc_ft_768.webp`,
    `https://photos.zillowstatic.com/fp/${HASH}-uncropped_scaled_within_1536_1152.jpg`,
    `https://photos.zillowstatic.com/fp/${HASH}-p_d.jpg`,
    `https://photos.zillowstatic.com/fp/${HASH}.jpg`,
  ];

  it("collapses every rendition of one picture to one key", () => {
    const keys = new Set(variants.map((url) => photoSourceKey(url)));
    expect([...keys]).toEqual([`zillow:${HASH}`]);
  });

  it("keeps two different pictures apart", () => {
    expect(photoSourceKey(`https://photos.zillowstatic.com/fp/${HASH}-cc_ft_768.jpg`)).not.toBe(
      photoSourceKey("https://photos.zillowstatic.com/fp/999zzz-cc_ft_768.jpg"),
    );
  });

  it("keeps a dash in the hash itself", () => {
    // Only the known variant suffixes come off; an unrecognised one is part of
    // the identity, because guessing there is how two photos become one.
    expect(photoSourceKey("https://photos.zillowstatic.com/fp/ab-cd-cc_ft_768.jpg")).toBe(
      "zillow:ab-cd",
    );
    expect(photoSourceKey("https://photos.zillowstatic.com/fp/ab-cd-xyz.jpg")).toBe(
      "zillow:ab-cd-xyz",
    );
  });

  it("falls back to host and path off the /fp/ ladder", () => {
    expect(photoSourceKey("https://photos.zillowstatic.com/static/hero.jpg")).toBe(
      "photos.zillowstatic.com/static/hero.jpg",
    );
  });
});

describe("photoSourceKey — filename hosts", () => {
  it("collapses StreetEasy's size suffixes", () => {
    const keys = new Set(
      [
        "https://photos.streeteasy.com/nyc/image/71/i-abc123-large.jpg",
        "https://photos.streeteasy.com/nyc/image/71/i-abc123-medium.jpg",
        "https://photos.streeteasy.com/nyc/image/71/i-abc123-small.jpg",
        "https://photos.streeteasy.com/nyc/image/71/i-abc123_1024x768.jpg",
        "https://photos.streeteasy.com/nyc/image/71/i-abc123-w800.jpg",
        "https://photos.streeteasy.com/nyc/image/71/i-abc123.webp",
      ].map((url) => photoSourceKey(url)),
    );
    expect([...keys]).toEqual(["photos.streeteasy.com:i-abc123"]);
  });

  it("ignores the directory the CDN filed it under", () => {
    // The same image moves between path prefixes; the filename is an id.
    expect(photoSourceKey("https://d1abc.cloudfront.net/a/b/img-9-large.jpg")).toBe(
      photoSourceKey("https://d1abc.cloudfront.net/z/img-9-small.jpg"),
    );
  });

  it("keeps two different filenames apart", () => {
    expect(photoSourceKey("https://photos.streeteasy.com/x/i-aaa-large.jpg")).not.toBe(
      photoSourceKey("https://photos.streeteasy.com/x/i-bbb-large.jpg"),
    );
  });
});

describe("photoSourceKey — everything else", () => {
  it("drops the query and the fragment", () => {
    const bare = photoSourceKey("https://cdn.example.com/photos/kitchen.jpg");
    expect(photoSourceKey("https://cdn.example.com/photos/kitchen.jpg?w=640")).toBe(bare);
    expect(photoSourceKey("https://cdn.example.com/photos/kitchen.jpg?auto=webp&q=70")).toBe(
      bare,
    );
    expect(photoSourceKey("https://cdn.example.com/photos/kitchen.jpg#x")).toBe(bare);
  });

  it("is case-insensitive and protocol-agnostic", () => {
    const key = "cdn.example.com/photos/kitchen.jpg";
    expect(photoSourceKey("https://CDN.Example.com/Photos/Kitchen.JPG")).toBe(key);
    expect(photoSourceKey("//cdn.example.com/photos/kitchen.jpg")).toBe(key);
    expect(photoSourceKey("http://cdn.example.com/photos/kitchen.jpg")).toBe(key);
  });

  it("trims surrounding whitespace", () => {
    expect(photoSourceKey("  https://cdn.example.com/a.jpg\n")).toBe("cdn.example.com/a.jpg");
  });

  it("keeps different paths on one host apart", () => {
    expect(photoSourceKey("https://cdn.example.com/a/1.jpg")).not.toBe(
      photoSourceKey("https://cdn.example.com/b/1.jpg"),
    );
  });
});

describe("photoSourceKey — no key at all", () => {
  it("has none for a manual upload", () => {
    // `listing_photos.source_url` is null for a photo off somebody's phone. It
    // is not a rendition of anything and must never make a page's photo look
    // like a duplicate.
    expect(photoSourceKey(null)).toBeNull();
    expect(photoSourceKey(undefined)).toBeNull();
    expect(photoSourceKey("")).toBeNull();
    expect(photoSourceKey("   ")).toBeNull();
  });

  it("has none for anything that is not an http(s) URL", () => {
    expect(photoSourceKey("data:image/png;base64,iVBORw0KGgo=")).toBeNull();
    expect(photoSourceKey("ftp://example.com/a.jpg")).toBeNull();
    expect(photoSourceKey("/relative/a.jpg")).toBeNull();
    expect(photoSourceKey("not a url")).toBeNull();
  });
});

describe("photoSourceKey — craigslist", () => {
  it("treats the 50px crop thumb as the same picture as the 600 and 1200 renditions", () => {
    const keys = [
      "https://images.craigslist.org/00b0b_WnEb0S2okd_0CI0t1_50x50c.jpg",
      "https://images.craigslist.org/00b0b_WnEb0S2okd_0CI0t1_600x450.jpg",
      "https://images.craigslist.org/00b0b_WnEb0S2okd_0CI0t1_1200x900.jpg",
    ].map(photoSourceKey);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe("images.craigslist.org:00b0b_wneb0s2okd_0ci0t1");
  });

  it("keeps two craigslist pictures apart", () => {
    expect(
      photoSourceKey("https://images.craigslist.org/00b0b_WnEb0S2okd_0CI0t1_600x450.jpg"),
    ).not.toBe(
      photoSourceKey("https://images.craigslist.org/00a0a_iRpcJELq2zH_0CI0t1_600x450.jpg"),
    );
  });
});
