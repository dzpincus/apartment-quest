"use client";

/**
 * Full-screen photo viewer for the detail page gallery.
 *
 * Three ways through a set of pictures, because this is used on a phone in a
 * hallway as often as on a laptop: arrow keys, swipe, and the two chevrons.
 * The counter ("3 / 9") is what tells you the swipe worked when the next photo
 * has not decoded yet.
 *
 * The image box can also go true full screen (`useFullscreen`), which is a
 * different thing from this dialog: the browser's own surface, no chrome, no
 * 75dvh cap, Escape handled natively. Where element full screen does not exist
 * (iPhone Safari) the toggle is simply absent — this dialog already fills the
 * viewport there, which is exactly what the button would have bought.
 *
 * The images are plain `<img>` tags, not `next/image`: they come from a public
 * Supabase bucket, they are already re-encoded to 1280px webp by
 * `/api/photos`, and the optimiser would only re-fetch and re-compress work
 * that has been done.
 */

import { useCallback, useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { FullscreenButton } from "@/components/listings/fullscreen-button";
import { photoUrl } from "@/lib/photos-client";
import { useFullscreen } from "@/lib/use-fullscreen";
import { cn } from "@/lib/utils";
import type { PhotoRef } from "@/lib/queries";

/** Below this a swipe is a scroll or a fat finger, not an instruction. */
const SWIPE_PX = 48;

export function PhotoLightbox({
  photos,
  index,
  label,
  onIndexChange,
  onOpenChange,
}: {
  photos: PhotoRef[];
  /** `null` closes it. Index into `photos`, clamped by the callers below. */
  index: number | null;
  label: string;
  onIndexChange: (index: number) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const open = index !== null && photos.length > 0;
  const current = open ? photos[Math.min(index, photos.length - 1)] : undefined;
  const startX = useRef<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const fullscreen = useFullscreen(box);

  const step = useCallback(
    (delta: number) => {
      if (index === null || photos.length === 0) return;
      // Wrap: nine photos and a flick of the thumb should not dead-end.
      onIndexChange((index + delta + photos.length) % photos.length);
    },
    [index, photos.length, onIndexChange],
  );

  // Window-level so the keys work wherever focus landed inside the dialog —
  // the close button takes it on open, and a keydown handler on the popup
  // would then be listening to the wrong element.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        step(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        step(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, step]);

  if (!current) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100%-1rem)] gap-2 bg-card p-2 sm:max-w-4xl">
        <DialogTitle className="sr-only">
          {label} — photo {(index ?? 0) + 1} of {photos.length}
        </DialogTitle>

        <div
          ref={box}
          className={cn(
            "relative flex touch-pan-y items-center justify-center overflow-hidden rounded-2xl bg-inset",
            // Full screen is the browser's black surface, not a card: the
            // rounding and the inset colour would both read as a bug there.
            fullscreen.active && "size-full rounded-none bg-black",
          )}
          onPointerDown={(event) => {
            startX.current = event.clientX;
          }}
          onPointerUp={(event) => {
            const from = startX.current;
            startX.current = null;
            if (from === null) return;
            const dx = event.clientX - from;
            if (Math.abs(dx) >= SWIPE_PX) step(dx < 0 ? 1 : -1);
          }}
          onPointerCancel={() => {
            startX.current = null;
          }}
        >
          {/* Public bucket, already sized and stripped by the route. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={current.id}
            src={photoUrl(current.storage_path)}
            alt={`${label} photo ${(index ?? 0) + 1}`}
            width={current.width ?? undefined}
            height={current.height ?? undefined}
            draggable={false}
            className={cn(
              "w-auto max-w-full rounded-2xl object-contain select-none",
              fullscreen.active
                ? "max-h-full rounded-none"
                : // Room for the counter and the dialog's own padding.
                  "max-h-[75dvh]",
            )}
          />

          {photos.length > 1 && (
            <>
              <Arrow side="left" onClick={() => step(-1)} />
              <Arrow side="right" onClick={() => step(1)} />

              {/* The counter below the picture is outside the element that
                  goes full screen, so it stops existing there. This one only
                  appears when that happens. */}
              {fullscreen.active && (
                <span
                  className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/55 px-2.5 py-1 text-xs font-extrabold text-white tabular-nums"
                  aria-hidden="true"
                >
                  {(index ?? 0) + 1} / {photos.length}
                </span>
              )}
            </>
          )}

          {/* Top *left*: the dialog's close button owns the top right, and two
              round buttons in one corner is a mis-tap waiting to happen. */}
          {fullscreen.supported && (
            <FullscreenButton
              active={fullscreen.active}
              onClick={fullscreen.toggle}
              className="top-2 left-2"
            />
          )}
        </div>

        <p className="pb-1 text-center text-xs font-extrabold text-muted-foreground tabular-nums">
          {(index ?? 0) + 1} / {photos.length}
        </p>
      </DialogContent>
    </Dialog>
  );
}

function Arrow({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === "left" ? "Previous photo" : "Next photo"}
      className={`absolute top-1/2 ${side === "left" ? "left-2" : "right-2"} -translate-y-1/2 rounded-full border-2 border-border bg-card/85 p-1.5 text-foreground hover:bg-surface-hover`}
    >
      <Icon className="size-5" />
    </button>
  );
}
