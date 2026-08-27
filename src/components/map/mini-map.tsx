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
 * Zoomable, so "where is this in the neighbourhood" can be answered by
 * pulling back to the saved places — but **cooperative**: a card you scroll
 * past must not steal the page's scroll. MapLibre's `cooperativeGestures`
 * makes a plain wheel scroll the page (ctrl/⌘ + wheel zooms the map) and a
 * one-finger touch scroll the page (two fingers pan and pinch), and the +/−
 * buttons always work. Built once: only the pin's draggability changes with
 * `movable`, and that is a marker option, not a map one.
 */

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
// Not `maplibre-gl` directly: that module sets the worker URL, which Turbopack
// otherwise leaves empty. See `maplibre.ts`.
import { MapLibreMap, Marker, NavigationControl, type MapOptions } from "@/components/map/maplibre";
import { loadMapStyle, MAP_STYLE_FAILED_MESSAGE } from "@/components/map/map-style";
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
  /** Turns on drag-to-correct for the listing pin. */
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
  // `loadMapStyle` falls back to CARTO rather than rejecting, so reaching this
  // means even the lifeboat sank. The listings map has said so all along; a
  // silent grey rectangle on the detail card looked like a bug in the pin.
  const [failed, setFailed] = useState(false);

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
          cooperativeGestures: true,
          // Two axes are plenty on a 200px card; a tilted, rotated
          // neighbourhood is harder to read, not easier.
          dragRotate: false,
          pitchWithRotate: false,
          touchPitch: false,
          attributionControl: { compact: true },
        });
        map.touchZoomRotate.disableRotation();
        map.addControl(new NavigationControl({ showCompass: false }), "top-right");
        mapRef.current = map;
        map.on("load", () => {
          if (!cancelled) setReady(true);
        });
      })
      .catch((error) => {
        console.warn("[map] mini map failed to start", error);
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      pinRef.current = null;
      pinKeyRef.current = null;
      locationMarkersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
      setReady(false);
      setFailed(false);
    };
    // Coordinates are handled by the effect below — re-creating the map when a
    // drag lands would throw the tiles away mid-gesture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // Moving is a `setLngLat`; a re-let at a new rent is a different pin, and
    // `draggable` is a constructor option, so the element is rebuilt only when
    // what it *says* or whether it can be dragged changes.
    const key = `${label}|${color}|${ariaLabel}|${movable}`;
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
  }, [lat, lng, label, color, ariaLabel, movable, ready]);

  // Re-centre only when the pin actually moves — not when "Move pin" is
  // toggled, which would snap a zoomed-out map back in on the person using it.
  useEffect(() => {
    mapRef.current?.setCenter([lng, lat]);
  }, [lat, lng, ready]);

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
    <div className="relative">
      <div
        ref={containerRef}
        className={cn(
          "aq-map h-[200px] w-full overflow-hidden rounded-2xl border-2 border-border bg-[#1a1836]",
          className,
        )}
        // A control surface, not a picture: it zooms, and sometimes the pin
        // drags. Calling it an image would hide both from a screen reader.
        role="region"
        aria-label={movable ? `${ariaLabel} — drag the pin to correct it` : ariaLabel}
      />
      {failed && (
        <p className="absolute inset-x-4 top-1/2 z-10 -translate-y-1/2 rounded-2xl bg-card/95 p-3 text-center text-sm text-muted-foreground">
          {MAP_STYLE_FAILED_MESSAGE}
        </p>
      )}
    </div>
  );
}
