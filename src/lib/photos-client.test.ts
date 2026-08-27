import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { photoUrl, prefetchPhotos, PHOTO_BUCKET } from "./photos-client";
import { sortPhotos } from "./queries";
import type { PhotoRef } from "./queries";

/**
 * Two pure things sit between the database and a rendered photo, and both fail
 * silently when they are wrong: a bad URL is a broken tile, a bad sort is a
 * strip that reshuffles itself on every refetch. Neither shows up as an error
 * anywhere, so they are pinned down here.
 */

const BASE = "https://demo.supabase.co";
const PREVIOUS = process.env.NEXT_PUBLIC_SUPABASE_URL;

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = BASE;
});

afterEach(() => {
  if (PREVIOUS === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = PREVIOUS;
});

const LISTING = "aaaaaaaa-0000-0000-0000-000000000001";

function photo(id: string, sort: number): PhotoRef {
  return {
    id,
    storage_path: `${LISTING}/${id}.webp`,
    thumb_path: `${LISTING}/${id}_thumb.webp`,
    width: 1280,
    height: 960,
    sort,
  };
}

describe("photoUrl", () => {
  it("builds the public object URL for a bucket path", () => {
    expect(photoUrl(`${LISTING}/abc.webp`)).toBe(
      `${BASE}/storage/v1/object/public/${PHOTO_BUCKET}/${LISTING}/abc.webp`,
    );
  });

  it("keeps the path separator but escapes the segments", () => {
    // The route only ever writes `<uuid>/<uuid>.webp`, but a hand-written row
    // must not be able to smuggle a query string onto the storage endpoint.
    const url = photoUrl("listing id/a b?c.webp");
    expect(url).toContain("/listing%20id/a%20b%3Fc.webp");
    expect(url.split("?")).toHaveLength(1);
  });

  it("tolerates a leading slash on the path and a trailing one on the base", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = `${BASE}/`;
    expect(photoUrl("/x/y.webp")).toBe(
      `${BASE}/storage/v1/object/public/${PHOTO_BUCKET}/x/y.webp`,
    );
  });

  it("returns an empty string rather than a URL with `undefined` in it", () => {
    expect(photoUrl(null)).toBe("");
    expect(photoUrl("")).toBe("");
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect(photoUrl("x/y.webp")).toBe("");
  });
});

describe("prefetchPhotos", () => {
  /** Node has no `Image`; the carousel's browser has one, so stand one in. */
  function withImageStub<T>(run: () => T): { result: T; requested: string[] } {
    const requested: string[] = [];
    const previous = (globalThis as { Image?: unknown }).Image;
    (globalThis as { Image?: unknown }).Image = class {
      set src(value: string) {
        requested.push(value);
      }
    };
    try {
      return { result: run(), requested };
    } finally {
      if (previous === undefined) delete (globalThis as { Image?: unknown }).Image;
      else (globalThis as { Image?: unknown }).Image = previous;
    }
  }

  it("asks for the main image of every photo, in order", () => {
    // The 1280px rendition, not the thumbnail: this runs the moment somebody
    // starts swiping, and what they are about to see is the big one.
    const photos = [photo("a", 0), photo("b", 1)];
    const { result, requested } = withImageStub(() => prefetchPhotos(photos));
    expect(result).toEqual([
      `${BASE}/storage/v1/object/public/${PHOTO_BUCKET}/${LISTING}/a.webp`,
      `${BASE}/storage/v1/object/public/${PHOTO_BUCKET}/${LISTING}/b.webp`,
    ]);
    expect(requested).toEqual(result);
  });

  it("drops photos that cannot become a URL rather than fetching the page", () => {
    // `photoUrl` returns "" with no env var, and `new Image().src = ""` is a
    // request for the current document.
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const { result, requested } = withImageStub(() => prefetchPhotos([photo("a", 0)]));
    expect(result).toEqual([]);
    expect(requested).toEqual([]);
  });

  it("is a no-op on an empty or absent set", () => {
    expect(prefetchPhotos([])).toEqual([]);
    expect(prefetchPhotos(null)).toEqual([]);
    expect(prefetchPhotos(undefined)).toEqual([]);
  });

  it("builds the URLs without an `Image` to load them into", () => {
    // Server render, or a test: it must not throw on the way past.
    expect(prefetchPhotos([photo("a", 0)])).toHaveLength(1);
  });
});

describe("sortPhotos", () => {
  it("orders by sort ascending", () => {
    const rows = [photo("c", 2), photo("a", 0), photo("b", 1)];
    expect(sortPhotos(rows).map((p) => p.id)).toEqual(["a", "b", "c"]);
  });

  it("breaks ties by id, so a merge cannot reshuffle the strip", () => {
    // `merge_listings` (0007) repoints a duplicate's photos without renumbering
    // them, so two photos sharing a `sort` is expected rather than corrupt.
    const rows = [photo("b", 0), photo("a", 0), photo("c", 0)];
    expect(sortPhotos(rows).map((p) => p.id)).toEqual(["a", "b", "c"]);
    expect(sortPhotos(rows.slice().reverse()).map((p) => p.id)).toEqual(["a", "b", "c"]);
  });

  it("does not mutate what it was given", () => {
    const rows = [photo("c", 2), photo("a", 0)];
    sortPhotos(rows);
    expect(rows.map((p) => p.id)).toEqual(["c", "a"]);
  });

  it("treats a missing embed as no photos", () => {
    expect(sortPhotos(undefined)).toEqual([]);
    expect(sortPhotos(null)).toEqual([]);
    expect(sortPhotos([])).toEqual([]);
  });
});
