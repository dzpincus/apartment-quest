"use client";

/**
 * Element full screen, with the one fallback that matters.
 *
 * Every place we show a photo at size — the lightbox and the card carousel —
 * offers the same toggle, so this is a hook rather than three copies of the
 * vendor-prefix dance.
 *
 * **iPhone Safari has no element full screen.** `requestFullscreen` exists on
 * `<video>` there and nowhere else, so `fullscreenSupported` is a real
 * question and not a formality: it answers "can *this* element go full
 * screen", and the callers answer a `false` by opening `PhotoLightbox`
 * instead, which already fills the viewport. Nothing renders a button that
 * does nothing.
 *
 * `webkit*` is kept for older Safari, which spells the request, the exit, the
 * element and the event four different ways. Escape is the browser's — no
 * handler here fights it — and `fullscreenchange` is the only thing that sets
 * `active`, so the icon follows the real state even when the user leaves full
 * screen by a route we never called.
 */

import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";

/**
 * The document's full-screen surface, as much of it as we touch. Structural
 * (and method syntax, so a real `Document` is assignable) which is what lets
 * `fullscreenSupported` be a pure function with a plain-object test.
 */
export type FullscreenDoc = {
  fullscreenEnabled?: boolean;
  webkitFullscreenEnabled?: boolean;
  fullscreenElement?: Element | null;
  webkitFullscreenElement?: Element | null;
  exitFullscreen?(): unknown;
  webkitExitFullscreen?(): unknown;
};

/** The element's half of the same surface. */
export type FullscreenElement = {
  requestFullscreen?(options?: FullscreenOptions): unknown;
  webkitRequestFullscreen?(): unknown;
};

/**
 * Can `el` be taken full screen in `doc`?
 *
 * Three ways to be false, and the third is the interesting one: a browser can
 * report full screen as enabled and still not implement it for arbitrary
 * elements (iOS), so the request method has to be there too.
 */
export function fullscreenSupported(
  doc: FullscreenDoc | null | undefined,
  el: FullscreenElement | null | undefined,
): boolean {
  if (!doc || !el) return false;
  const enabled = doc.fullscreenEnabled ?? doc.webkitFullscreenEnabled ?? false;
  if (!enabled) return false;
  return (
    typeof el.requestFullscreen === "function" ||
    typeof el.webkitRequestFullscreen === "function"
  );
}

/** Whichever element the document currently has full screen, either spelling. */
export function fullscreenElement(doc: FullscreenDoc): Element | null {
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

/**
 * Is `el` the element `doc` currently has full screen?
 *
 * The `el` null check is the whole function. `fullscreenElement` returns null
 * when *nothing* is full screen, and `ref.current` is null until the element
 * mounts — the lightbox's image box only exists while the dialog is open — so
 * a bare `===` reads "nothing is full screen and nothing is mounted" as *yes,
 * full screen*. That is a true `active` with no full-screen session behind it,
 * and the lightbox answers it by laying its stage out as `size-full` inside a
 * dialog that shrink-wraps its content: a 48x44 box with the photo gone.
 *
 * Null on either side is "no", so the value cannot start true.
 */
export function isFullscreenOn(
  doc: FullscreenDoc | null | undefined,
  el: Element | null | undefined,
): boolean {
  if (!doc || !el) return false;
  return fullscreenElement(doc) === el;
}

function exitFullscreen(doc: FullscreenDoc): void {
  const exit = doc.exitFullscreen ?? doc.webkitExitFullscreen;
  if (typeof exit !== "function") return;
  // Safari's is void, everyone else's is a promise that rejects when there is
  // nothing to exit. Neither is worth an unhandled rejection.
  try {
    void Promise.resolve(exit.call(doc)).catch(() => {});
  } catch {
    /* not full screen after all */
  }
}

export type Fullscreen = {
  /** False on iPhone Safari, and before hydration. Then use the lightbox. */
  supported: boolean;
  active: boolean;
  /** True when a request actually went out. */
  enter: () => boolean;
  exit: () => void;
  /** True when it did something; false means "not supported, do your fallback". */
  toggle: () => boolean;
};

/**
 * Support never changes within a page, so there is nothing to subscribe to —
 * but `useSyncExternalStore` is still the right shape: it reads `document` on
 * the client, returns the server's constant during SSR and hydration, and
 * costs no state and no effect. (`usePrefersReducedMotion` in
 * `photo-carousel.tsx` is the same pattern with a real subscription.)
 */
function subscribeToNothing(): () => void {
  return () => {};
}

/**
 * `ref.current` is null until the element mounts — the lightbox's image box
 * only exists while the dialog is open — so `documentElement` stands in for
 * it. Support is a fact about the browser, not about the div: in a document
 * that allows full screen every element can be asked, and in the one that does
 * not (iPhone Safari) no element can.
 */
function readSupport(): boolean {
  return fullscreenSupported(document, document.documentElement);
}

export function useFullscreen(ref: RefObject<HTMLElement | null>): Fullscreen {
  // False on the server and through hydration, which is correct: this cannot
  // be known before there is a `document`, and a button that might do nothing
  // is worse than one that appears a frame late.
  const supported = useSyncExternalStore(subscribeToNothing, readSupport, () => false);
  const [active, setActive] = useState(false);

  useEffect(() => {
    // `sync` is safe to run before the element mounts: a null ref is not full
    // screen, so the first read is false and stays false until the browser
    // says otherwise. Nor is there a state it can miss by running early — an
    // element cannot already be full screen at the moment it mounts, and every
    // later transition arrives as `fullscreenchange`.
    const sync = () => setActive(isFullscreenOn(document, ref.current));
    sync();
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, [ref]);

  // Closing the dialog (or navigating) while full screen: the spec says
  // removing the full-screen element exits it, but "the spec says" and "every
  // browser does" are different sentences, and a stranded full-screen session
  // is a black rectangle with no way out but Escape.
  useEffect(
    () => () => {
      const el = fullscreenElement(document);
      if (el && !el.isConnected) exitFullscreen(document);
    },
    [],
  );

  const enter = useCallback(() => {
    const el: FullscreenElement | null = ref.current;
    if (!el) return false;
    const request = el.requestFullscreen ?? el.webkitRequestFullscreen;
    if (typeof request !== "function") return false;
    try {
      // A rejected request (no user gesture, a browser policy) is a no-op:
      // `fullscreenchange` never fires, so `active` stays false and the icon
      // stays honest.
      void Promise.resolve(request.call(el)).catch(() => {});
    } catch {
      return false;
    }
    return true;
  }, [ref]);

  const exit = useCallback(() => exitFullscreen(document), []);

  const toggle = useCallback(() => {
    if (isFullscreenOn(document, ref.current)) {
      exitFullscreen(document);
      return true;
    }
    return enter();
  }, [enter, ref]);

  return { supported, active, enter, exit, toggle };
}
