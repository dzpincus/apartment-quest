import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { photoUrl, PHOTO_BUCKET } from "./photos-client";
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
