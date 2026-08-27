"use client";

/**
 * A listing's photos as a swipeable strip, sized for a card.
 *
 * The 64px round thumbnail this replaced answered "does this listing have a
 * picture". It did not answer the question anybody actually has on a phone —
 * *what does it look like* — and answering that meant opening the listing.
 * Now the card itself is the first eight photos, a thumb-flick apart.
 *
 * **The track is a scroll container, not a transform.** One `overflow-x-auto`
 * with `snap-x snap-mandatory` gets native momentum, native rubber-banding,
 * native accessibility and a working trackpad for free, and costs nothing on
 * the listings page's bundle. A JS drag handler would be worse in every one of
 * those ways and would still have to fight the vertical scroll of the list it
 * sits in.
 *
 * **Nothing loads until somebody asks.** Sixty cards × eight photos is 480
 * requests for a page nobody has scrolled, so a resting card renders exactly
 * one `<img>` — slide 0 — and the rest are empty boxes of the right size. The
 * first touch, arrow click or arrow key *arms* it: every slide becomes real
 * and `prefetchPhotos` warms the whole set in one go. The wait is felt once,
 * at the moment a person has said they want the photos, instead of once per
 * swipe with a grey box between each. `slidesToRender` (`src/lib/carousel.ts`)
 * is that rule, and it is tested.
 *
 * **The arrows live inside the image box.** Both breakpoints get them — a
 * phone gets swipe *and* arrows, because a card in a scrolling list is a place
 * where people tap rather than drag — and because they are absolutely
 * positioned within the fixed-aspect box, the vertical space they occupy is
 * space the picture already owns. They can never land on the address.
 *
 * **Full screen is the same box, bigger.** The toggle in the top-right corner
 * takes *this* element full screen, so the swipe, the arrows, the counter and
 * the index all keep working — there is no second component to keep in sync.
 * The slides switch from `object-cover` to `object-contain` on black there: a
 * 16:10 crop is right for a card and wrong for a whole screen. Where element
 * full screen does not exist (iPhone Safari) the button opens the lightbox
 * instead, which is the same answer at the same tap.
 *
 * Images are plain `<img>` from the public bucket with a two-rendition
 * `srcSet`: the 400px thumb for a narrow low-DPR card, the 1280px main image
 * for everything else. `next/image` would re-fetch and re-compress work
 * `/api/photos` has already done.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ChevronLeft, ChevronRight, Image as ImageIcon } from "lucide-react";
import { FullscreenButton } from "@/components/listings/fullscreen-button";
import { photoUrl, prefetchPhotos } from "@/lib/photos-client";
import { nextIndex, prevIndex, slidesToRender } from "@/lib/carousel";
import { useFullscreen } from "@/lib/use-fullscreen";
import { cn } from "@/lib/utils";
import type { PhotoRef } from "@/lib/queries";

/** A pointer that travelled further than this was a swipe, not a tap. */
const TAP_SLOP_PX = 10;

/** Card shapes. 16/10 on the listing cards, 16/9 in the map's mini card. */
const ASPECT = {
  "16/10": "aspect-[16/10]",
  "16/9": "aspect-[16/9]",
} as const;

export type CarouselAspect = keyof typeof ASPECT;

export function PhotoCarousel({
  photos,
  alt,
  className,
  aspect = "16/10",
  onOpen,
}: {
  photos: PhotoRef[];
  /** The listing's label — every slide's alt text is built from it. */
  alt: string;
  className?: string;
  aspect?: CarouselAspect;
  /** Tap (not swipe) on the picture. Absent means the box is not clickable. */
  onOpen?: (index: number) => void;
}) {
  const count = photos.length;
  const boxRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const fullscreen = useFullscreen(boxRef);
  const [index, setIndex] = useState(0);
  const [armed, setArmed] = useState(false);
  /** The index the full-screen effect reads, so it is not keyed on the index. */
  const indexRef = useRef(0);
  const reduced = usePrefersReducedMotion();
  /** Where a pointer went down, so a drag can be told from a tap. */
  const down = useRef<{ x: number; y: number } | null>(null);
  const raf = useRef<number | null>(null);

  /**
   * The first sign of interest: render every slide and warm the cache.
   *
   * Idempotent by design — it is wired to pointerdown, touchstart, both
   * arrows and the keyboard, and all four can fire for one gesture.
   */
  const arm = useCallback(() => {
    setArmed((was) => {
      if (!was) prefetchPhotos(photos);
      return true;
    });
  }, [photos]);

  const scrollTo = useCallback(
    (to: number) => {
      const el = trackRef.current;
      if (!el) return;
      setIndex(to);
      el.scrollTo({ left: to * el.clientWidth, behavior: reduced ? "auto" : "smooth" });
    },
    [reduced],
  );

  // The index follows the scroll position rather than driving it: a native
  // swipe never calls `scrollTo`, and the counter has to be right anyway.
  // One rAF per burst — a scroll event fires dozens of times a second.
  function onScroll() {
    const el = trackRef.current;
    if (!el || raf.current !== null) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = null;
      const width = el.clientWidth;
      if (width === 0) return;
      const at = Math.round(el.scrollLeft / width);
      setIndex(Math.max(0, Math.min(count - 1, at)));
    });
  }

  useEffect(() => {
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
  }, []);

  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  // Entering or leaving full screen is a resize of the scroll container, and a
  // scroll container keeps its `scrollLeft`, not its slide: without this, photo
  // 3 of 9 becomes a seam between 1 and 2. Jumps rather than animates — the
  // screen has just changed size, a 300ms glide on top of that reads as a bug.
  const fullscreenActive = fullscreen.active;
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    // One frame later: the new size is not laid out at the moment the event
    // fires, so `clientWidth` here is still the old box's.
    const id = requestAnimationFrame(() => {
      el.scrollTo({ left: indexRef.current * el.clientWidth, behavior: "auto" });
    });
    return () => cancelAnimationFrame(id);
  }, [fullscreenActive]);

  if (count === 0) {
    // The same tile `ListingThumb` falls back to, at the carousel's shape: a
    // list where some cards start with a picture and others start with the
    // address is a list with no rhythm at all.
    return (
      <div
        className={cn(
          "grid w-full place-items-center overflow-hidden rounded-2xl border-2 border-border bg-inset",
          ASPECT[aspect],
          className,
        )}
        aria-hidden="true"
      >
        <ImageIcon className="size-8 text-faint" />
      </div>
    );
  }

  const live = new Set(slidesToRender(armed, count));

  return (
    <div
      ref={boxRef}
      role="region"
      aria-roledescription="carousel"
      aria-label={`${alt} — ${count} ${count === 1 ? "photo" : "photos"}`}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        arm();
        scrollTo(event.key === "ArrowLeft" ? prevIndex(index, count) : nextIndex(index, count));
      }}
      className={cn(
        "relative w-full overflow-hidden rounded-2xl border-2 border-border bg-inset",
        "focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none",
        ASPECT[aspect],
        // Full screen is a screen, not a card: the card's shape, border and
        // rounding all have to go, and the letterboxing is black.
        fullscreen.active && "aspect-auto size-full rounded-none border-0 bg-black",
        className,
      )}
    >
      <div
        ref={trackRef}
        onScroll={onScroll}
        onPointerDown={(event) => {
          arm();
          down.current = { x: event.clientX, y: event.clientY };
        }}
        onTouchStart={arm}
        onPointerUp={(event) => {
          const from = down.current;
          down.current = null;
          if (!from || !onOpen) return;
          const moved =
            Math.abs(event.clientX - from.x) > TAP_SLOP_PX ||
            Math.abs(event.clientY - from.y) > TAP_SLOP_PX;
          // A swipe that ends over the picture is not a request to open it —
          // and in full screen neither is a tap: the lightbox would open
          // behind the browser's own surface, where nobody can see it.
          if (!moved && !fullscreen.active) onOpen(index);
        }}
        onPointerCancel={() => {
          down.current = null;
        }}
        className={cn(
          "absolute inset-0 flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain",
          // The scrollbar is chrome on a photograph. `touch-pan-y` is not set:
          // this element *is* the horizontal panner, and the page scrolls
          // vertically through it because `overscroll-x-contain` only holds
          // the axis this one owns.
          "[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          !reduced && "scroll-smooth",
          onOpen && "cursor-pointer",
        )}
      >
        {photos.map((photo, i) => (
          <div key={photo.id} className="relative h-full w-full shrink-0 snap-start snap-always">
            {live.has(i) ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={photoUrl(armed ? photo.storage_path : photo.thumb_path)}
                /* Two renditions, one decision, made by the browser: a 400px
                   card on a 1x screen takes the thumbnail, a 412px card on a
                   3x phone takes the 1280px original. Both already exist. */
                srcSet={`${photoUrl(photo.thumb_path)} 400w, ${photoUrl(photo.storage_path)} 1280w`}
                sizes="(min-width: 768px) 420px, 100vw"
                alt={`${alt} photo ${i + 1} of ${count}`}
                width={photo.width ?? undefined}
                height={photo.height ?? undefined}
                /* Slide 0 is the card's picture and is on screen the moment
                   the row is; the rest are one swipe away at best. */
                loading={i === 0 ? "eager" : "lazy"}
                decoding="async"
                draggable={false}
                className={cn(
                  "size-full select-none",
                  fullscreen.active ? "object-contain" : "object-cover",
                )}
              />
            ) : (
              /* Not a spinner: this box is only ever seen for the instant
                 between arming and the image landing, and a card full of
                 spinners looks broken in a way a card full of dark boxes
                 does not. */
              <div className="size-full bg-inset" aria-hidden="true" />
            )}
          </div>
        ))}
      </div>

      {/* Top right is the one corner with nothing in it: the arrows are
          vertically centred and the counter is bottom right. Present whenever
          it can do something — element full screen, or the lightbox where
          that does not exist. */}
      {(fullscreen.supported || onOpen) && (
        <FullscreenButton
          active={fullscreen.active}
          onClick={() => {
            // Every slide has to be real before the box triples in size.
            arm();
            if (!fullscreen.toggle()) onOpen?.(index);
          }}
          className="top-1.5 right-1.5 size-8 md:size-9"
        />
      )}

      {count > 1 && (
        <>
          {/* Inside the box, so the space they take is the picture's, never
              the address's. Smaller under `md` because a phone's arrow is the
              alternate entry to a gesture that already works. */}
          {index > 0 && (
            <Arrow
              side="left"
              onClick={() => {
                arm();
                scrollTo(prevIndex(index, count));
              }}
            />
          )}
          {index < count - 1 && (
            <Arrow
              side="right"
              onClick={() => {
                arm();
                scrollTo(nextIndex(index, count));
              }}
            />
          )}

          <span
            className="pointer-events-none absolute right-1.5 bottom-1.5 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-extrabold text-white tabular-nums"
            aria-hidden="true"
          >
            {index + 1} / {count}
          </span>
        </>
      )}
    </div>
  );
}

function Arrow({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      // The track owns pointerdown for arming and tap detection; a bubbling
      // arrow press would also read as a tap on the picture and open the
      // lightbox instead of stepping.
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
      aria-label={side === "left" ? "Previous photo" : "Next photo"}
      className={cn(
        "absolute inset-y-0 z-10 my-auto grid size-8 place-items-center rounded-full bg-black/50 text-white md:size-9",
        "hover:bg-black/70 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none",
        side === "left" ? "left-1.5" : "right-1.5",
      )}
    >
      <Icon className="size-4 md:size-5" />
    </button>
  );
}

/**
 * `prefers-reduced-motion`, read once and then watched.
 *
 * Only the *programmatic* steps animate — a native swipe is the finger's
 * speed, not ours — so this drops `scroll-smooth` and makes the arrows jump.
 * Default `false` on the server so the first paint matches the majority.
 */
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeToMotionPreference(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function usePrefersReducedMotion(): boolean {
  // `useSyncExternalStore` rather than an effect that sets state: the media
  // query *is* an external store, the snapshot is a boolean so there is no
  // cached-object trap (`prefs.ts` has that problem and solves it the hard
  // way), and the server snapshot is the one that has to be a constant.
  return useSyncExternalStore(
    subscribeToMotionPreference,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}
