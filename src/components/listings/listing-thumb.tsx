"use client";

/**
 * The first photo of a listing, as a square tile — 64px on the mobile cards,
 * 40px in the desktop table. Shared so the two never drift apart, and kept out
 * of `photo-gallery.tsx` so the listings table does not pull the upload
 * machinery into its bundle for a picture it only reads.
 *
 * No photo is a tile, not a gap: a list where some rows have an image and
 * others start at the address reads as broken alignment. Person colour is not
 * used here — the card border and the table's left rail already carry it, and a
 * coloured frame around a photograph would fight it.
 */

import { Image as ImageIcon } from "lucide-react";
import { photoUrl } from "@/lib/photos-client";
import { cn } from "@/lib/utils";
import type { PhotoRef } from "@/lib/queries";

export function ListingThumb({
  photo,
  alt,
  className,
}: {
  photo: PhotoRef | undefined;
  alt: string;
  className?: string;
}) {
  const base = cn(
    "shrink-0 overflow-hidden rounded-2xl border-2 border-border bg-inset",
    className,
  );

  if (!photo) {
    return (
      <span className={cn(base, "grid place-items-center")} aria-hidden="true">
        <ImageIcon className="size-1/3 text-faint" />
      </span>
    );
  }

  return (
    <span className={base}>
      {/* Public bucket thumbnail, already 400px webp — no optimiser. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photoUrl(photo.thumb_path)}
        alt={alt}
        loading="lazy"
        draggable={false}
        className="size-full object-cover"
      />
    </span>
  );
}
