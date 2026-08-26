"use client";

/**
 * Client-side image shrinking, so a phone does not upload 4MB of camera roll
 * over a subway connection for a picture that will be re-encoded to 1280px
 * anyway. The server still runs the real re-encode (`/api/photos` with sharp);
 * this is purely about what goes over the wire.
 *
 * Every failure path returns the original file. A browser that cannot decode
 * what the picker handed it (HEIC in Chrome is the common one) must still get
 * as far as the route, which answers with a sentence a person can act on —
 * silently dropping the file here would look like a broken button.
 */

/** Longest edge after resizing. Twice the stored size, so quality survives. */
export const DEFAULT_MAX_EDGE = 1600;

/** webp at 0.85 is visually lossless for photographs at this size. */
const QUALITY = 0.85;

/** Below this, re-encoding buys nothing worth the CPU on a phone. */
const SKIP_UNDER_BYTES = 300 * 1024;

export async function resizeImage(
  file: File,
  maxEdge: number = DEFAULT_MAX_EDGE,
): Promise<Blob> {
  if (typeof document === "undefined" || typeof createImageBitmap !== "function") {
    return file;
  }
  // Not our problem and not decodable: SVG has no pixel size to speak of and
  // HEIC will throw below. Either way the file goes as-is.
  if (file.type && !/^image\/(jpeg|png|webp|gif|bmp|avif)$/i.test(file.type)) return file;
  if (file.size <= SKIP_UNDER_BYTES) return file;

  let bitmap: ImageBitmap;
  try {
    // `imageOrientation: "from-image"` applies the EXIF rotation a phone writes
    // instead of the pixels — without it a portrait photo is re-encoded
    // sideways and the orientation tag is thrown away with the metadata.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file;
  }

  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/webp", QUALITY);
    });
    // A browser without webp encoding hands back null (or a PNG, which would be
    // bigger than what we started with) — keep the original in both cases.
    if (!blob || blob.type !== "image/webp" || blob.size >= file.size) return file;
    return blob;
  } catch {
    return file;
  } finally {
    bitmap.close?.();
  }
}

/** `IMG_0421.HEIC` -> `IMG_0421.webp`, for the name sent with a resized blob. */
export function webpName(name: string): string {
  const base = name.replace(/\.[^.]+$/, "") || "photo";
  return `${base}.webp`;
}
