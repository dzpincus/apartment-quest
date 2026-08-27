"use client";

/**
 * The listings, as pins.
 *
 * Deliberately not `react-map-gl`: one component, one imperative map, and a
 * `Marker` per row with a DOM element built in `pin.ts`. Sixty pins is far
 * below where symbol layers earn their complexity, and DOM markers get focus
 * rings, `aria-label`s and Tailwind-free inline colours for free.
 *
 * Everything here is bulk-loaded only when somebody asks for the map: this
 * module (and `maplibre-gl`, ~250KB gzipped) is behind `next/dynamic` at both
 * call sites, so the list view stays exactly as heavy as it was.
 *
 * The rows are whatever the page's `applyFilters` produced — the map never
 * filters, so the pins and the table can never disagree.
 */

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
// Not `maplibre-gl` directly: that module sets the worker URL, which Turbopack
// otherwise leaves empty. See `maplibre.ts`.
import {
  LngLatBounds,
  MapLibreMap,
  Marker,
  type MapOptions,
} from "@/components/map/maplibre";
import { loadMapStyle, MAP_STYLE_FAILED_MESSAGE } from "@/components/map/map-style";
import {
  applyListingPinState,
  ensureMapCss,
  listingPinElement,
  locationPinElement,
} from "@/components/map/pin";
import {
  loadStations,
  stationsGeoJSON,
  type Station,
  type StationFeatureCollection,
} from "@/lib/geo/stations";
import { listingLabel, rentShort } from "@/lib/format";
import { isVanished } from "@/lib/queue";
import { cn } from "@/lib/utils";
import type { ListingRow } from "@/lib/queries";
import type { Location, Uuid } from "@/lib/types";

/** Manhattan-ish. Only ever seen when nothing on screen has coordinates. */
const NYC: [number, number] = [-73.97, 40.72];

/**
 * Zoom at which a station stops being a dot and starts being a place with a
 * name on it. The listings fit-bounds lands around 11-12, so this can no
 * longer be the zoom at which stations *exist* — that read as a broken toggle.
 */
export const STATION_LABEL_MIN_ZOOM = 14;

/** The line letters ("A C E") arrive two zooms before the station name does. */
export const STATION_LINES_MIN_ZOOM = 12;

/** One GeoJSON source, three layers hung off it. */
const STATION_SOURCE = "aq-stations";
const STATION_DOTS_LAYER = "aq-station-dots";
const STATION_LINES_LAYER = "aq-station-lines";
const STATION_NAMES_LAYER = "aq-station-names";
const STATION_LAYERS = [STATION_DOTS_LAYER, STATION_LINES_LAYER, STATION_NAMES_LAYER];

/** `--quiet` and the page colour: a station is information, not a headline. */
const STATION_COLOR = "#8ed8ff";
const STATION_STROKE = "#1a1836";
const STATION_TEXT = "#f2efff";

/** One pin fit to its own bounds would be zoom 22, i.e. a roof. */
const SINGLE_PIN_ZOOM = 15;

export type ListingsMapProps = {
  rows: ListingRow[];
  locations: Location[];
  selectedId?: Uuid | null;
  onSelect: (id: Uuid | null) => void;
  /** The starred place, drawn with a ring. */
  primaryLocationId?: Uuid | null;
  /** Chips the page owns — "3 unlocated · Locate all", "Manage locations". */
  chips?: React.ReactNode;
  className?: string;
};

type Placed = ListingRow & { lat: number; lng: number };

const isPlaced = (row: ListingRow): row is Placed => row.lat != null && row.lng != null;

/** What a pin says out loud. Rent first: it is why anyone is looking. */
function pinLabel(row: Placed): string {
  const rent = row.rent == null ? "no rent yet" : `${rentShort(row.rent)} a month`;
  const gone = isVanished(row) ? ", may be gone" : "";
  return `${listingLabel(row.address, row.unit)}, ${rent}${gone}`;
}

export function ListingsMap({
  rows,
  locations,
  selectedId = null,
  onSelect,
  primaryLocationId = null,
  chips,
  className,
}: ListingsMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [showLocations, setShowLocations] = useState(true);
  const [showStations, setShowStations] = useState(false);
  const [stations, setStations] = useState<Station[] | null>(null);

  // Handlers reach the map through a ref: re-creating the map because a parent
  // re-rendered would throw away the tiles somebody just panned to.
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  });

  const placed = useMemo(() => rows.filter(isPlaced), [rows]);

  // Every marker on the map, by what it draws. Declared above the map effect
  // because that effect's cleanup has to empty them: React 19's development
  // double-mount tears the map down and builds a new one, and a marker cache
  // that survives would leave the second map with no pins on it at all.
  const markersRef = useRef(new Map<Uuid, { marker: Marker; el: HTMLElement; key: string }>());
  const locationMarkersRef = useRef<Marker[]>([]);

  // -- the map itself ---------------------------------------------------------

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    ensureMapCss();
    let cancelled = false;
    // Captured now rather than read in the cleanup: same Map object either way,
    // and the lint rule is right that a ref read at teardown is usually a bug.
    const markers = markersRef.current;

    void loadMapStyle()
      .then((style) => {
        if (cancelled || !containerRef.current) return;
        const map = new MapLibreMap({
          container,
          style: style as unknown as MapOptions["style"],
          center: NYC,
          zoom: 11,
          // Licence, not decoration: OpenFreeMap + © OpenStreetMap stay on
          // screen. Compact so a phone gets an "i" instead of a paragraph.
          attributionControl: { compact: true },
        });
        mapRef.current = map;
        // Tapping the map itself is how you put a mini card away.
        map.on("click", () => onSelectRef.current(null));
        map.on("load", () => {
          if (!cancelled) setReady(true);
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      markers.clear();
      locationMarkersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  // -- listing pins -----------------------------------------------------------

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const markers = markersRef.current;
    const seen = new Set<Uuid>();

    for (const row of placed) {
      seen.add(row.id);
      const dimmed = isVanished(row);
      const color = row.added_by_person?.color ?? "#888";
      const label = row.rent == null ? "—" : rentShort(row.rent);
      // Anything that changes what the element *is* forces a rebuild; the
      // selection is not in the key, because that is a style change.
      const key = `${row.lat},${row.lng},${label},${color},${dimmed}`;
      const existing = markers.get(row.id);
      if (existing?.key === key) continue;
      existing?.marker.remove();

      const el = listingPinElement({
        label,
        color,
        dimmed,
        selected: selectedId === row.id,
        ariaLabel: pinLabel(row),
      });
      el.addEventListener("click", (event) => {
        // Without this the map's own click handler deselects in the same tick.
        event.stopPropagation();
        onSelectRef.current(row.id);
      });
      const marker = new Marker({ element: el }).setLngLat([row.lng, row.lat]).addTo(map);
      markers.set(row.id, { marker, el, key });
    }

    for (const [id, entry] of markers) {
      if (seen.has(id)) continue;
      entry.marker.remove();
      markers.delete(id);
    }
    // `selectedId` is read but deliberately not a dependency: the effect below
    // owns selection, and rebuilding every pin on a tap would flicker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placed, ready]);

  // Selection: a style change on elements that already exist.
  useEffect(() => {
    for (const [id, entry] of markersRef.current) {
      const row = placed.find((r) => r.id === id);
      applyListingPinState(entry.el, {
        selected: id === selectedId,
        dimmed: row ? isVanished(row) : false,
      });
    }
    const map = mapRef.current;
    const chosen = placed.find((row) => row.id === selectedId);
    if (!map || !chosen) return;
    // Only move the map when the pin is not already comfortably on screen —
    // the mini card slides over the bottom third, and a pin behind it reads as
    // the wrong apartment.
    const bounds = map.getBounds();
    const height = map.getContainer().clientHeight;
    const point = map.project([chosen.lng, chosen.lat]);
    if (!bounds.contains([chosen.lng, chosen.lat]) || point.y > height - 180) {
      map.easeTo({ center: [chosen.lng, chosen.lat], duration: 350 });
    }
  }, [selectedId, placed, ready]);

  // Fit to whatever is on screen, whenever *which* listings are on screen
  // changes. Not on selection, and not on every render: a fit that fires while
  // somebody is reading a card is the map arguing with them.
  const boundsKey = useMemo(
    () => placed.map((row) => `${row.id}:${row.lat},${row.lng}`).join("|"),
    [placed],
  );

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || placed.length === 0) return;
    if (placed.length === 1) {
      map.easeTo({
        center: [placed[0].lng, placed[0].lat],
        zoom: Math.max(map.getZoom(), SINGLE_PIN_ZOOM),
        duration: 300,
      });
      return;
    }
    const bounds = new LngLatBounds();
    for (const row of placed) bounds.extend([row.lng, row.lat]);
    map.fitBounds(bounds, {
      padding: { top: 64, left: 32, right: 32, bottom: 150 },
      maxZoom: 15.5,
      duration: 350,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boundsKey, ready]);

  // -- saved places -----------------------------------------------------------

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    for (const marker of locationMarkersRef.current) marker.remove();
    locationMarkersRef.current = [];
    if (!showLocations) return;
    for (const location of locations) {
      const el = locationPinElement({
        emoji: location.emoji,
        name: location.name,
        primary: location.id === primaryLocationId,
      });
      locationMarkersRef.current.push(
        new Marker({ element: el }).setLngLat([location.lng, location.lat]).addTo(map),
      );
    }
  }, [locations, primaryLocationId, showLocations, ready]);

  // -- subway ----------------------------------------------------------------

  useEffect(() => {
    if (!showStations || stations) return;
    let cancelled = false;
    void loadStations()
      .then((loaded) => {
        if (!cancelled) setStations(loaded);
      })
      .catch(() => {
        if (!cancelled) setStations([]);
      });
    return () => {
      cancelled = true;
    };
  }, [showStations, stations]);

  const stationData = useMemo(
    () => (stations ? stationsGeoJSON(stations) : null),
    [stations],
  );

  // The subway is a source and three layers, not four hundred markers.
  // MapLibre culls to the viewport, scales the dots with zoom and collides the
  // labels on the GPU, so there is no per-`moveend` redraw to write and no cap
  // to pick — and, unlike the marker pass this replaces, the dots are there at
  // whatever zoom the listings fit-bounds happens to land on.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !stationData) return;
    const source = map.getSource(STATION_SOURCE) as
      | { setData?: (data: StationFeatureCollection) => void }
      | undefined;
    if (source?.setData) source.setData(stationData);
    else addStationLayers(map, stationData);
  }, [ready, stationData]);

  // Toggling is a layout property, not a teardown: the source stays uploaded,
  // so turning the chip back on is a frame rather than a fetch. Its own effect
  // so that a tap on the chip does not re-upload 445 points.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    for (const id of STATION_LAYERS) {
      if (!map.getLayer(id)) continue;
      map.setLayoutProperty(id, "visibility", showStations ? "visible" : "none");
    }
  }, [ready, stationData, showStations]);

  return (
    <div className={cn("relative overflow-hidden rounded-[20px] border-2 border-border", className)}>
      <div
        ref={containerRef}
        className="aq-map size-full bg-[#1a1836]"
        role="region"
        aria-label={`Map of ${placed.length} listing${placed.length === 1 ? "" : "s"}`}
      />

      <div className="pointer-events-none absolute top-2 left-2 z-10 flex max-w-[calc(100%-1rem)] flex-wrap items-center gap-1.5">
        <MapChip
          on={showLocations}
          onClick={() => setShowLocations((v) => !v)}
          label={`${locations.length} saved place${locations.length === 1 ? "" : "s"}`}
        >
          ★ Locations
        </MapChip>
        <MapChip
          on={showStations}
          onClick={() => setShowStations((v) => !v)}
          label="Subway stations"
        >
          🚇 Stations
        </MapChip>
        {chips}
      </div>

      {failed && (
        <p className="absolute inset-x-4 top-1/2 z-10 -translate-y-1/2 rounded-2xl bg-card/95 p-4 text-center text-sm text-muted-foreground">
          {MAP_STYLE_FAILED_MESSAGE} The list still works.
        </p>
      )}
      {!ready && !failed && (
        <p className="absolute inset-0 z-10 flex items-center justify-center text-sm text-muted-foreground">
          Loading the map…
        </p>
      )}
    </div>
  );
}

/**
 * The font the basemap is already using, or null when the style cannot spell.
 *
 * MapLibre only draws text it has glyphs for, and the CARTO lifeboat style
 * (`map-style.ts`) is raster tiles with no glyph endpoint at all — asking it
 * for "Noto Sans Regular" would be one console error per tile and no labels
 * either way. Borrowing the stack from an existing symbol layer also means the
 * station names are set in whatever OpenFreeMap ships, rather than in a font
 * name hard-coded here that upstream is free to stop hosting.
 */
function stationFontStack(map: MapLibreMap): string[] | null {
  const style = map.getStyle() as unknown as {
    glyphs?: string;
    layers?: { type?: string; layout?: Record<string, unknown> }[];
  };
  if (!style.glyphs) return null;
  for (const layer of style.layers ?? []) {
    if (layer.type !== "symbol") continue;
    const font = layer.layout?.["text-font"];
    if (Array.isArray(font) && font.length > 0 && font.every((f) => typeof f === "string")) {
      return font as string[];
    }
  }
  return ["Noto Sans Regular"];
}

/**
 * Source plus layers, added hidden — the effect above turns them on. Split out
 * of the component because it is a hundred lines of style spec and none of it
 * closes over a prop.
 */
function addStationLayers(map: MapLibreMap, data: StationFeatureCollection): void {
  map.addSource(STATION_SOURCE, { type: "geojson", data });

  map.addLayer({
    id: STATION_DOTS_LAYER,
    type: "circle",
    source: STATION_SOURCE,
    layout: { visibility: "none" },
    paint: {
      "circle-color": STATION_COLOR,
      "circle-stroke-color": STATION_STROKE,
      // A full stop across a borough, a target on a street. This is what the
      // old `zoom >= 14` gate was actually after, done by interpolation
      // instead of by an all-or-nothing threshold.
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 3, 15, 8],
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 10, 1, 15, 2],
      "circle-opacity": 0.9,
    },
  });

  const font = stationFontStack(map);
  if (!font) return;

  // The routes, under the dot: at zoom 12 "L" or "A C E" is the useful fact
  // about a station — which train, not which entrance.
  map.addLayer({
    id: STATION_LINES_LAYER,
    type: "symbol",
    source: STATION_SOURCE,
    minzoom: STATION_LINES_MIN_ZOOM,
    layout: {
      visibility: "none",
      "text-field": ["get", "lines_label"],
      "text-font": font,
      "text-size": ["interpolate", ["linear"], ["zoom"], 12, 10, 15, 12],
      "text-offset": [0, 1.1],
      // Collision on, deliberately: in midtown the honest answer is to drop
      // some labels, not to stack them into a smear.
      "text-allow-overlap": false,
    },
    paint: {
      "text-color": STATION_TEXT,
      "text-halo-color": STATION_STROKE,
      "text-halo-width": 1.2,
    },
  });

  // The name, above the dot, once there is room to read it.
  map.addLayer({
    id: STATION_NAMES_LAYER,
    type: "symbol",
    source: STATION_SOURCE,
    minzoom: STATION_LABEL_MIN_ZOOM,
    layout: {
      visibility: "none",
      "text-field": ["get", "name"],
      "text-font": font,
      "text-size": 11,
      "text-offset": [0, -1.2],
      "text-allow-overlap": false,
    },
    paint: {
      "text-color": STATION_TEXT,
      "text-halo-color": STATION_STROKE,
      "text-halo-width": 1.2,
    },
  });
}

/**
 * The chip look, shared by the map's own toggles and by anything the page
 * hangs beside them (the locations dialog's trigger). 44px on a phone — the
 * SPEC's tap target — and the compact height on a pointer device, where the
 * space is the map's.
 */
export const MAP_CHIP_CLASS =
  "pointer-events-auto inline-flex h-11 items-center gap-1.5 rounded-full border-2 px-3.5 text-[13px] font-extrabold shadow-[0_2px_0_rgba(0,0,0,0.35)] md:h-8 md:px-3 md:text-xs";

/** A toggle on the map. `on` drives both the fill and `aria-pressed`. */
export function MapChip({
  on,
  label,
  className,
  children,
  ...props
}: React.ComponentProps<"button"> & { on?: boolean; label?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={label}
      className={cn(
        MAP_CHIP_CLASS,
        on
          ? "border-primary bg-primary text-ink"
          : "border-border bg-card/95 text-muted-foreground hover:text-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
