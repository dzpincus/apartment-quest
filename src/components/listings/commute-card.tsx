"use client";

/**
 * "Getting there" — where this apartment is, and how long it takes to reach
 * the places we care about.
 *
 * Three answers, none of them computed here: the pin comes from
 * `/api/geocode` (stored on the row), the minutes come from `commute_times`
 * embedded in the listing query the page already ran, and the nearest station
 * is haversine over a bundled file. The only buttons that cost anything are
 * **Locate** and **Refresh times**, and both say so by being buttons.
 *
 * The mini map is `next/dynamic`, `ssr: false` — `maplibre-gl` is a quarter of
 * a megabyte and this card is worth its own chunk.
 */

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Compass, Crosshair, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { LocationsDialog } from "@/components/listings/locations-dialog";
import { PoweredByGoogle } from "@/components/listings/powered-by-google";
import { commuteIndex, useCommutes, useLocations, type ListingRow } from "@/lib/queries";
import { usePerson } from "@/lib/person";
import { useMutations } from "@/lib/mutations";
import { useHiddenLocationIds, usePrimaryLocationId, visibleLocations } from "@/lib/prefs";
import {
  commuteMinutes,
  geocodeFailure,
  mapsDirectionsUrl,
  pinStatus,
  COMMUTE_MODE_LABELS,
} from "@/lib/geo-types";
import { loadStations, nearestStation, type NearestStation } from "@/lib/geo/stations";
import { listingLabel, rentShort } from "@/lib/format";
import { COMMUTE_MODES, type CommuteMode, type Location } from "@/lib/types";

const MiniMap = dynamic(
  () => import("@/components/map/mini-map").then((m) => m.MiniMap),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[200px] w-full rounded-2xl" />,
  },
);

/** The glyph in each column header. Modes are ordered by `COMMUTE_MODES`. */
const MODE_GLYPH: Record<CommuteMode, string> = {
  walk: "🚶",
  bike: "🚲",
  transit: "🚇",
};

export function CommuteCard({ listing }: { listing: ListingRow }) {
  const { person } = usePerson();
  const { data: locations = [] } = useLocations();
  const { data: commutes = [] } = useCommutes(listing.id);
  const hidden = useHiddenLocationIds(person?.id);
  const primaryId = usePrimaryLocationId(person?.id, locations);
  const { geocodeListing, setListingCoords, computeCommutes } = useMutations(person?.id);

  const [moving, setMoving] = useState(false);
  const shown = useMemo(() => visibleLocations(locations, hidden), [locations, hidden]);
  const index = useMemo(() => commuteIndex(commutes), [commutes]);
  const status = pinStatus(listing);
  const placed = listing.lat != null && listing.lng != null;

  /**
   * Drag-to-correct is offered without being asked for when the geocoder said
   * it was guessing — that warning is only useful next to the fix.
   *
   * Latched, and that is the whole point of the state: a landed drag writes
   * `geocode_note: 'manual'`, so `status` stops being `"check"` the instant
   * somebody lets go of the pin. `movable` is MapLibre's `interactive`, which
   * is a *constructor* option — flipping it back destroys the map and builds a
   * frozen one in its place, one tick after a drop, which read as the app
   * snatching the map away as a reward for using it.
   */
  const [offered, setOffered] = useState(status === "check");
  // Adjusted during render rather than in an effect: React's own answer for
  // state derived from a prop that has changed, and it means the map is never
  // built frozen and then rebuilt movable a tick later.
  const [lastStatus, setLastStatus] = useState(status);
  if (status !== lastStatus) {
    setLastStatus(status);
    if (status === "check") setOffered(true);
  }
  const draggable = moving || offered;

  const [station, setStation] = useState<NearestStation | null>(null);
  useEffect(() => {
    if (listing.lat == null || listing.lng == null) return;
    let cancelled = false;
    void loadStations()
      .then((stations) => {
        if (!cancelled) setStation(nearestStation(listing.lat!, listing.lng!, stations));
      })
      .catch(() => {
        /* A missing file is a missing line, not an error. */
      });
    return () => {
      cancelled = true;
    };
  }, [listing.lat, listing.lng]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Compass className="size-4" />
          Getting there
          {status === "check" && (
            <span
              className="rounded-full border border-due/40 bg-due/10 px-2 text-[11px] font-black text-due"
              title="The geocoder was guessing. Drag the pin if it landed on the wrong building."
            >
              ⚠ check pin
            </span>
          )}
          <span className="ml-auto flex flex-wrap items-center gap-2">
            <LocationsDialog />
            <Button
              variant="outline"
              size="sm"
              disabled={!placed || computeCommutes.isPending}
              onClick={() => computeCommutes.mutate({ listingId: listing.id, force: true })}
            >
              <RefreshCw />
              Refresh times
            </Button>
          </span>
        </CardTitle>
      </CardHeader>

      <CardContent className="grid gap-3">
        {placed ? (
          <>
            <MiniMap
              lat={listing.lat!}
              lng={listing.lng!}
              color={listing.added_by_person?.color ?? "#888"}
              label={listing.rent == null ? "—" : rentShort(listing.rent)}
              ariaLabel={`Map showing ${listingLabel(listing.address, listing.unit)}`}
              locations={shown}
              primaryLocationId={primaryId}
              movable={draggable}
              onMove={({ lat, lng }) =>
                setListingCoords.mutate({ listing, lat, lng })
              }
            />
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Button
                variant={draggable ? "secondary" : "ghost"}
                size="sm"
                aria-pressed={draggable}
                // "Done moving" has to clear the latch as well as the toggle,
                // or a pin that was ever offered for correction could never be
                // put down. A teardown here is a deliberate press, not the
                // surprise one that happened a tick after every drop.
                onClick={() => {
                  if (draggable) {
                    setMoving(false);
                    setOffered(false);
                  } else {
                    setMoving(true);
                  }
                }}
              >
                <Crosshair />
                {draggable ? "Done moving" : "Move pin"}
              </Button>
              {draggable && <span>Drag the pin onto the right building.</span>}
              {station && (
                <span>
                  Nearest subway: {station.name}
                  {station.lines.length > 0 && ` (${station.lines.join(", ")})`} ·{" "}
                  <span title="Straight-line estimate at 80 m/min, not a routed walk">
                    ~{station.walkMin} min walk
                  </span>
                </span>
              )}
            </div>
          </>
        ) : (
          <NoPin
            reason={geocodeFailure(listing.geocode_note)}
            pending={geocodeListing.isPending}
            onLocate={() => geocodeListing.mutate(listing.id)}
          />
        )}

        {/* No pin, no table. Every cell below is a Google Maps deep link built
            from the listing's coordinates, and with none they are built from
            0,0 — a spot in the Gulf of Guinea. A grid of em dashes linking to
            the middle of the ocean is not a smaller answer than the "Locate"
            button above it; it is a wrong one. */}
        {!placed ? null : shown.length === 0 ? (
          <p className="rounded-2xl border-2 border-dashed border-border p-4 text-center text-sm text-muted-foreground">
            Add a place you go a lot — work, gym, the good bagel spot.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-1 font-extrabold">Place</th>
                {COMMUTE_MODES.map((mode) => (
                  <th key={mode} className="py-1 text-right font-extrabold">
                    <span aria-hidden>{MODE_GLYPH[mode]}</span>{" "}
                    <span className="sr-only">{COMMUTE_MODE_LABELS[mode]}</span>
                    <span aria-hidden className="hidden sm:inline">
                      {COMMUTE_MODE_LABELS[mode]}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((location) => (
                <tr key={location.id} className="border-t border-border">
                  <td className="py-1.5">
                    <span className="flex items-center gap-1.5">
                      <span aria-hidden>{location.emoji?.trim() || "★"}</span>
                      <span className="truncate">{location.name}</span>
                      {location.id === primaryId && (
                        <span className="text-primary" title="Your starred place">
                          ⭐
                        </span>
                      )}
                    </span>
                  </td>
                  {COMMUTE_MODES.map((mode) => (
                    <CommuteCell
                      key={mode}
                      mode={mode}
                      location={location}
                      listing={listing}
                      row={index.get(location.id)?.get(mode)}
                    />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Google's terms allow Routes results away from a Google map only with
            this credit. Small, muted, and not optional — and gone with the
            table, because there is nothing left to credit. */}
        {placed && shown.length > 0 && <PoweredByGoogle />}
      </CardContent>
    </Card>
  );
}

/**
 * One duration. Always a link, even when there is no number: the deep link is
 * free, needs no key and works on a phone, so a pair Google refused still gets
 * somebody where they are going.
 */
function CommuteCell({
  mode,
  location,
  listing,
  row,
}: {
  mode: CommuteMode;
  location: Location;
  listing: ListingRow;
  row?: { seconds: number | null; error: string | null };
}) {
  const minutes = commuteMinutes(row?.seconds);
  const title = row?.error
    ? `${COMMUTE_MODE_LABELS[mode]}: ${row.error}`
    : row?.seconds == null
      ? `No ${COMMUTE_MODE_LABELS[mode].toLowerCase()} time yet — open in Google Maps`
      : `${COMMUTE_MODE_LABELS[mode]} directions in Google Maps`;

  return (
    <td className="py-1.5 text-right tabular-nums">
      <a
        href={mapsDirectionsUrl(
          { lat: listing.lat ?? 0, lng: listing.lng ?? 0 },
          { lat: location.lat, lng: location.lng },
          mode,
        )}
        target="_blank"
        rel="noreferrer"
        title={title}
        aria-label={`${COMMUTE_MODE_LABELS[mode]} to ${location.name}: ${minutes}`}
        className="inline-flex h-8 items-center justify-end px-1 underline-offset-4 hover:underline"
      >
        {minutes === "—" ? <span className="text-faint">—</span> : minutes}
      </a>
    </td>
  );
}

/**
 * No pin. Two different sentences on purpose: a `failed:` note means we looked
 * and nobody could place the address (retrying by hand is the *second* thing
 * to try, after fixing the address), a bare null means nobody has looked.
 */
function NoPin({
  reason,
  pending,
  onLocate,
}: {
  reason: string | null;
  pending: boolean;
  onLocate: () => void;
}) {
  return (
    <div className="grid gap-2 rounded-2xl border-2 border-dashed border-border p-4 text-center">
      <p className="text-sm text-muted-foreground">
        {reason ? `Couldn't place this address: ${reason}` : "Not on the map yet."}
      </p>
      <Button size="lg" className="justify-self-center" disabled={pending} onClick={onLocate}>
        <Crosshair />
        {reason ? "Try again" : "Locate"}
      </Button>
    </div>
  );
}
