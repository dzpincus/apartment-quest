"use client";

/**
 * Full-screen photo viewer for the detail page gallery.
 *
 * Three ways through a set of pictures, because this is used on a phone in a
 * hallway as often as on a laptop: arrow keys, swipe, and the two chevrons.
 * The counter ("3 / 9") is what tells you the swipe worked when the next photo
 * has not decoded yet.
 *
 * Two rules keep stepping from feeling like loading:
 *
 * 1. The stage is a *fixed* box — `min(92vw, 1280px)` by `min(78dvh, 860px)`,
 *    black, with `object-contain` inside it. It used to be sized by the image,
 *    which meant a dialog that collapsed toward nothing and sprang back on
 *    every press of the right arrow. Nothing about the chrome (counter,
 *    chevrons, close, full-screen toggle) moves between photos now, because
 *    nothing about the box depends on the photo.
 * 2. The current photo *and both neighbours* stay mounted
 *    (`visibleIndices`, `src/lib/carousel.ts`), the hidden ones at
 *    `opacity-0`. A step is then a 150ms crossfade between two `<img>` tags
 *    the browser has already decoded rather than a fresh request. Opening also
 *    fires `prefetchPhotos` for the whole set, which covers the far end of a
 *    wrap and every entry point at once — the callers warm it too, a frame
 *    earlier, at the tap.
 *
 * When a photo genuinely is not ready (cold cache, slow connection) the stage
 * holds the neighbour we stepped off and puts a spinner over it. It never goes
 * blank and it never resizes.
 *
 * The image box can also go true full screen (`useFullscreen`), which is a
 * different thing from this dialog: the browser's own surface, no chrome, no
 * dvh cap, Escape handled natively. Where element full screen does not exist
 * (iPhone Safari) the toggle is simply absent — this dialog already fills the
 * viewport there, which is exactly what the button would have bought.
 *
 * The images are plain `<img>` tags, not `next/image`: they come from a public
 * Supabase bucket, they are already re-encoded to 1280px webp by
 * `/api/photos`, and the optimiser would only re-fetch and re-compress work
 * that has been done.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { FullscreenButton } from "@/components/listings/fullscreen-button";
import { photoUrl, prefetchPhotos } from "@/lib/photos-client";
import { visibleIndices } from "@/lib/carousel";
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
  const at = open ? Math.min(index, photos.length - 1) : 0;
  const current = open ? photos[at] : undefined;
  const startX = useRef<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const fullscreen = useFullscreen(box);

  /**
   * Photo ids whose bytes are in and decoded, so the spinner knows when to
   * stop. Keyed by id and never cleared: a refetch hands us a new array of the
   * same rows every time the tab regains focus, and resetting on that would
   * flash a spinner over a picture that is sitting in the HTTP cache.
   */
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(() => new Set());
  const markLoaded = useCallback((id: string) => {
    setLoaded((was) => (was.has(id) ? was : new Set(was).add(id)));
  }, []);

  const ready = current ? loaded.has(current.id) : false;

  /**
   * The photo we stepped *off*, adjusted during render rather than in an
   * effect (the documented pattern for "state derived from a prop that
   * changed" — an effect here would be a second render pass for something the
   * first one already knows). It is only read while the new photo is still
   * decoding.
   */
  const [trail, setTrail] = useState<{ at: number; held: number | null }>({ at, held: null });
  if (trail.at !== at) {
    const leaving = photos[trail.at];
    setTrail({ at, held: leaving && loaded.has(leaving.id) ? trail.at : trail.held });
  }
  const held = trail.held;

  /**
   * Which photo is actually visible. The current one once it is ready;
   * otherwise the neighbour we just stepped off — but *only* a neighbour. A
   * held index further away is a stale open or the far side of a wrap, and
   * showing photo 1 while the counter says 9 is worse than a spinner.
   */
  const shown = ready || held === null || Math.abs(held - at) > 1 ? at : held;

  /** One warm-up per open, for the whole set. Cheap: it is the HTTP cache. */
  const warmed = useRef(false);
  useEffect(() => {
    if (!open) {
      warmed.current = false;
      return;
    }
    if (warmed.current) return;
    warmed.current = true;
    prefetchPhotos(photos);
  }, [open, photos]);

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
  // would then be listening to the wrong element. **Capture phase**, because
  // the dialog's own key handling (Base UI's focus trap and the buttons inside
  // it) sits between the target and the window in the bubbling phase and can
  // stop an arrow key before it ever gets here — which read as "the arrows do
  // nothing". Seeing the event first is the fix; the keys have no other job
  // while the lightbox is open. Home/End jump to the first and last photo.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      let delta: number | null = null;
      if (event.key === "ArrowLeft") delta = -1;
      else if (event.key === "ArrowRight") delta = 1;
      else if (event.key === "Home") delta = -at;
      else if (event.key === "End") delta = photos.length - 1 - at;
      if (delta === null) return;
      event.preventDefault();
      event.stopPropagation();
      step(delta);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [open, step, at, photos.length]);

  if (!current) return null;

  const mounted = visibleIndices(at, photos.length);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* `w-auto max-w-none`: the dialog is sized by the fixed stage below
          rather than the other way round. The `sm:` variant has to be undone
          by name — `DialogContent` ships `sm:max-w-sm`, and tailwind-merge
          treats a prefixed class as a different group from a bare one. */}
      <DialogContent className="w-auto max-w-none gap-2 bg-card p-2 sm:max-w-none">
        <DialogTitle className="sr-only">
          {label} — photo {at + 1} of {photos.length}
        </DialogTitle>

        <div
          ref={box}
          className={cn(
            "relative flex touch-pan-y items-center justify-center overflow-hidden bg-black",
            fullscreen.active
              ? // The browser's own black surface: rounding there reads as a bug.
                "size-full rounded-none"
              : // The stable stage. Independent of the photo on purpose — this
                // is the whole fix for the collapsing dialog.
                "h-[min(78dvh,860px)] w-[min(92vw,1280px)] rounded-2xl",
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
          {/* Current, previous and next, all mounted, stacked, only one
              visible. No width/height attributes: the box fixes the geometry
              and an intrinsic ratio here would fight it. */}
          {mounted.map((i) => {
            const photo = photos[i];
            const visible = i === shown;
            return (
              /* Public bucket, already sized and stripped by the route. */
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                key={photo.id}
                ref={(el) => {
                  // A cached image can be complete before React attaches a
                  // load handler, and `onLoad` then never fires.
                  if (el?.complete && el.naturalWidth > 0) markLoaded(photo.id);
                }}
                src={photoUrl(photo.storage_path)}
                alt={visible ? `${label} photo ${i + 1}` : ""}
                aria-hidden={!visible}
                decoding="async"
                fetchPriority={i === at ? "high" : "low"}
                draggable={false}
                onLoad={() => markLoaded(photo.id)}
                // A photo that 404s must not spin forever.
                onError={() => markLoaded(photo.id)}
                className={cn(
                  "absolute inset-0 size-full object-contain transition-opacity duration-150 select-none motion-reduce:transition-none",
                  visible ? "opacity-100" : "pointer-events-none opacity-0",
                )}
              />
            );
          })}

          {!ready && (
            <span
              className="pointer-events-none absolute inset-0 grid place-items-center"
              aria-hidden="true"
            >
              <Loader2 className="size-8 animate-spin text-white/80" />
            </span>
          )}

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
                  {at + 1} / {photos.length}
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
          {at + 1} / {photos.length}
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
