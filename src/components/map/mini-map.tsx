"use client";

/**
 * One listing, its saved places, and nothing else — the 200px map at the top
 * of the "Getting there" card.
 *
 * Its own component rather than `<ListingsMap interactive={false}>`: this map
 * has one pin that can be *dragged*, no fit-bounds argument with a selection,
 * no chip row and no station layer, and threading four "…except here" props
 * through the big one would have cost more than the forty lines below. Both
 * share the style, the pin builders and the CSS.
 *
 * Frozen until somebody asks to move the pin: a card you scroll past should
 * not steal a two-finger gesture from the page.
 */

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { Map as MapLibreMap, Marker, type MapOptions } from "maplibre-gl";
import { loadMapStyle } from "@/components/map/map-style";
import { ensureMapCss, listingPinElement, locationPinElement } from "@/components/map/pin";
import { cn } from "@/lib/utils";
import type { Location, Uuid } from "@/lib/types";

export type MiniMapProps = {
  lat: number;
  lng: number;
  /** Whoever found the listing — `people.color`, as ever. */
  color: string;
  /** `$5.2k`, already formatted. */
  label: string;
  ariaLabel: string;
  locations: Location[];
  primaryLocationId?: Uuid | null;
  /** Turns on panning, zooming and drag-to-correct. */
  movable?: boolean;
  onMove?: (coords: { lat: number; lng: number }) => void;
  className?: string;
};

export function MiniMap({
  lat,
  lng,
  color,
  label,
  ariaLabel,
  locations,
  primaryLocationId = null,
  movable = false,
  onMove,
  className,
}: MiniMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const pinRef = useRef<Marker | null>(null);
  const pinKeyRef = useRef<string | null>(null);
  const locationMarkersRef = useRef<Marker[]>([]);
  const onMoveRef = useRef(onMove);
  useEffect(() => {
    onMoveRef.current = onMove;
  });
  // The style is fetched, so the map exists a tick after mount: the marker
  // effects below wait for it rather than silently doing nothing.
  const [ready, setReady] = useState(false);

  // The map is built once per (movable) mode: `interactive` is a constructor
  // option, so flipping "Move pin" genuinely is a new map.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    ensureMapCss();
    let cancelled = false;

    void loadMapStyle()
      .then((style) => {
        if (cancelled || !containerRef.current) return;
        const map = new MapLibreMap({
          container,
          style: style as unknown as MapOptions["style"],
          center: [lng, lat],
          zoom: 14.5,
          interactive: movable,
          attributionControl: { compact: true },
        });
        mapRef.current = map;
        map.on("load", () => {
          if (!cancelled) setReady(true);
        });
      })
      .catch(() => {
        /* The card below still works; a missing basemap is not an error state. */
      });

    return () => {
      cancelled = true;
      pinRef.current = null;
      pinKeyRef.current = null;
      locationMarkersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
      setReady(false);
    };
    // Coordinates are handled by the effect below — re-creating the map when a
    // drag lands would throw the tiles away mid-gesture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movable]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // Moving is a `setLngLat`; a re-let at a new rent is a different pin, so
    // the element is rebuilt only when what it *says* changes.
    const key = `${label}|${color}|${ariaLabel}`;
    if (pinRef.current && pinKeyRef.current === key) {
      pinRef.current.setLngLat([lng, lat]);
    } else {
      pinRef.current?.remove();
      const el = listingPinElement({ label, color, selected: true, ariaLabel });
      const marker = new Marker({ element: el, draggable: movable })
        .setLngLat([lng, lat])
        .addTo(map);
      marker.on("dragend", () => {
        const next = marker.getLngLat();
        onMoveRef.current?.({ lat: next.lat, lng: next.lng });
      });
      pinRef.current = marker;
      pinKeyRef.current = key;
    }
    map.setCenter([lng, lat]);
  }, [lat, lng, label, color, ariaLabel, movable, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const marker of locationMarkersRef.current) marker.remove();
    locationMarkersRef.current = locations.map((location) =>
      new Marker({
        element: locationPinElement({
          emoji: location.emoji,
          name: location.name,
          primary: location.id === primaryLocationId,
        }),
      })
        .setLngLat([location.lng, location.lat])
        .addTo(map),
    );
  }, [locations, primaryLocationId, ready]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "aq-map h-[200px] w-full overflow-hidden rounded-2xl border-2 border-border bg-[#1a1836]",
        className,
      )}
      // A frozen map is a picture; a movable one is a control surface, and
      // calling it an image would hide the draggable pin from a screen reader.
      role={movable ? "region" : "img"}
      aria-label={movable ? `${ariaLabel} — drag the pin to correct it` : ariaLabel}
    />
  );
}
