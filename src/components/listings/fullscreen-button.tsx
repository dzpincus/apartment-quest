"use client";

/**
 * The full-screen toggle that sits in the corner of a picture.
 *
 * Shared by the lightbox and the card carousel so the two can never drift into
 * different icons, sizes or labels for the same gesture. Black-on-white at 50%
 * like the carousel's arrows, because a control over a photograph has to work
 * on a white kitchen and a dark hallway.
 *
 * Position comes from the caller: the carousel has a free top-right corner,
 * the lightbox does not (the dialog's close button lives there).
 */

import { Maximize2, Minimize2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function FullscreenButton({
  active,
  onClick,
  className,
}: {
  active: boolean;
  onClick: () => void;
  className?: string;
}) {
  const Icon = active ? Minimize2 : Maximize2;
  return (
    <button
      type="button"
      // The carousel's track owns pointerdown for arming and tap detection, and
      // a bubbling press here would read as "open the lightbox" as well.
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
      aria-label={active ? "Exit full screen" : "Full screen"}
      aria-pressed={active}
      className={cn(
        "absolute z-10 grid size-9 place-items-center rounded-full bg-black/50 text-white",
        "hover:bg-black/70 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none",
        className,
      )}
    >
      <Icon className="size-4 md:size-5" />
    </button>
  );
}
