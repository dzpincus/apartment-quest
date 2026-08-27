"use client";

/**
 * The pictures, at the top of the listing detail page.
 *
 * Mobile gets a horizontal snap-scroll strip — a phone in a hallway between
 * two tours should be able to thumb through eight photos without the page
 * turning into a mile of column. Desktop gets a grid, because the horizontal
 * scroll of a trackpad is nobody's friend.
 *
 * Thumbnails are the `_thumb.webp` rendition (400px, ~20KB); the full 1280px
 * image is only fetched when the lightbox opens. Both are plain `<img>` from
 * the public bucket — see `photoUrl`.
 *
 * Removal is a two-tap confirm on the tile itself rather than a modal: a modal
 * for "delete this thumbnail" is heavier than the thing it protects, and
 * `window.confirm` looks like a browser error on a phone.
 */

import { useRef, useState } from "react";
import { Image as ImageIcon, Loader2, Plus, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PhotoLightbox } from "@/components/listings/photo-lightbox";
import { usePerson } from "@/lib/person";
import { useMutations } from "@/lib/mutations";
import { photoUrl, prefetchPhotos } from "@/lib/photos-client";
import { listingLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ListingRow } from "@/lib/queries";

/** Hold a thumb this long on a touch screen and the remove button appears. */
const LONG_PRESS_MS = 500;

export function PhotoGallery({ listing }: { listing: ListingRow }) {
  const { person } = usePerson();
  const { uploadPhotos, refreshPhotos, deletePhoto } = useMutations(person?.id);
  const inputRef = useRef<HTMLInputElement>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** A long press reveals the remove button; the click it ends with is not a tap. */
  const longPressed = useRef(false);

  const photos = listing.photos ?? [];
  const label = listingLabel(listing.address, listing.unit);
  const uploading = uploadPhotos.isPending;
  const refreshing = refreshPhotos.isPending;

  function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    // Reset first: picking the same file twice in a row fires no `change`
    // event otherwise, and "nothing happened" is indistinguishable from a bug.
    event.target.value = "";
    if (files.length === 0) return;
    uploadPhotos.mutate({ listingId: listing.id, files });
  }

  function startPress(id: string) {
    clearPress();
    longPressed.current = false;
    pressTimer.current = setTimeout(() => {
      longPressed.current = true;
      setRevealed(id);
    }, LONG_PRESS_MS);
  }

  function clearPress() {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  }

  return (
    <Card>
      <CardContent className="grid gap-3">
        <div className="flex items-center gap-2">
          <p className="text-sm font-extrabold">
            Photos{photos.length > 0 ? ` (${photos.length})` : ""}
          </p>
          {/* Only for a listing that came from somewhere: a hand-typed row has
              no page to go back to, and a button that can only ever say "that
              listing has no link" is a button nobody should be offered. */}
          {listing.url ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="ml-auto"
              disabled={refreshing}
              onClick={() => refreshPhotos.mutate({ listingId: listing.id })}
            >
              {refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              {refreshing ? "Looking…" : "Refresh photos"}
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            className={listing.url ? undefined : "ml-auto"}
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? <Loader2 className="animate-spin" /> : <Plus />}
            {uploading ? "Adding…" : "Add photos"}
          </Button>
          {/* `capture` is deliberately absent: on iOS it forces the camera and
              hides the camera roll, which is where tour photos already are. */}
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            onChange={onPick}
          />
        </div>

        {photos.length === 0 ? (
          <div className="flex items-center gap-3 rounded-2xl border-2 border-dashed border-border bg-inset p-4 text-sm text-muted-foreground">
            <ImageIcon className="size-5 shrink-0 text-faint" />
            <span>
              No photos yet. Import a listing link, or add some from your camera roll.
            </span>
          </div>
        ) : (
          <div
            className={cn(
              // Phone: one row that snaps. Desktop: a grid, no scrolling.
              "-mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto px-1 pb-1",
              "md:mx-0 md:grid md:grid-cols-4 md:overflow-visible md:px-0 lg:grid-cols-5",
            )}
          >
            {photos.map((photo, i) => (
              <div
                key={photo.id}
                className="group relative shrink-0 snap-start md:shrink"
                onPointerLeave={() => setRevealed(null)}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (longPressed.current) {
                      longPressed.current = false;
                      return; // the press that revealed the × must not also open it
                    }
                    // The whole set, warmed at the tap rather than one
                    // round trip per press of the right arrow. The thumbs
                    // above are the 400px rendition, so nothing here is in
                    // the cache yet. The lightbox warms it again on open —
                    // this is the frame it can do it a frame earlier.
                    prefetchPhotos(photos);
                    setLightbox(i);
                  }}
                  onPointerDown={() => startPress(photo.id)}
                  onPointerUp={clearPress}
                  onPointerCancel={clearPress}
                  aria-label={`Open photo ${i + 1} of ${photos.length}`}
                  className="block size-28 overflow-hidden rounded-2xl border-2 border-border bg-inset md:size-auto md:aspect-square md:w-full"
                >
                  {/* Public bucket thumbnail — no loader, no optimiser. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photoUrl(photo.thumb_path)}
                    alt={`${label} photo ${i + 1}`}
                    loading="lazy"
                    draggable={false}
                    className="size-full object-cover"
                  />
                </button>

                {confirming === photo.id ? (
                  <div className="absolute inset-0 grid place-items-center gap-1 rounded-2xl bg-card/90 p-1 text-center">
                    <span className="text-[11px] font-extrabold">Remove?</span>
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        size="xs"
                        variant="destructive"
                        disabled={deletePhoto.isPending}
                        onClick={() => {
                          setConfirming(null);
                          setRevealed(null);
                          deletePhoto.mutate({ photoId: photo.id, listingId: listing.id });
                        }}
                      >
                        Remove
                      </Button>
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost"
                        onClick={() => setConfirming(null)}
                      >
                        No
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirming(photo.id)}
                    aria-label={`Remove photo ${i + 1}`}
                    className={cn(
                      "absolute top-1 right-1 rounded-full border-2 border-border bg-card p-0.5 text-muted-foreground transition-opacity",
                      "hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100",
                      revealed === photo.id ? "opacity-100" : "opacity-0",
                    )}
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <PhotoLightbox
        photos={photos}
        index={lightbox}
        label={label}
        onIndexChange={setLightbox}
        onOpenChange={(open) => !open && setLightbox(null)}
      />
    </Card>
  );
}
