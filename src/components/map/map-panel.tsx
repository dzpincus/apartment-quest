"use client";

/**
 * Map mode on the listings page: the map, the chips that belong to the page
 * rather than to the map, and the card that slides up when a pin is tapped.
 *
 * Everything here reads the *same* `rows` array the table gets — already
 * filtered and sorted by `applyFilters` / `sortRows` upstairs — so the pins and
 * the list can never disagree about what is on screen.
 *
 * This module is the `next/dynamic` boundary's payload: importing it pulls in
 * `ListingsMap` and therefore `maplibre-gl`, which is why the listings page
 * imports *this* lazily and nothing else.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Crosshair } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ListingsMap, MapChip, MAP_CHIP_CLASS } from "@/components/map/listings-map";
import { LocationsDialog } from "@/components/listings/locations-dialog";
import { AmenityMarks } from "@/components/listings/amenity-marks";
import { GoneBadge } from "@/components/listings/gone-badge";
import { VoteChips } from "@/components/listings/vote-chips";
import { PersonDot } from "@/components/person-dot";
import { queryKeys, useLocations, type ListingRow } from "@/lib/queries";
import { usePerson } from "@/lib/person";
import { computeCommutes, geocodeListing } from "@/lib/mutations";
import { useHiddenLocationIds, usePrimaryLocationId } from "@/lib/prefs";
import { pinStatus } from "@/lib/geo-types";
import { bedsBaths, listingLabel, money } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Uuid } from "@/lib/types";

/**
 * How many times "Locate all" may go back to `/api/commutes` for the rest of
 * the grid. Five passes is 1,500 pairs — more than this hunt will ever have —
 * and a ceiling rather than a `while` because the thing being repeated is the
 * only paid call in the app.
 */
const MAX_COMMUTE_PASSES = 5;

export function MapPanel({ rows }: { rows: ListingRow[] }) {
  const { person } = usePerson();
  const qc = useQueryClient();
  const { data: locations = [] } = useLocations();
  const hidden = useHiddenLocationIds(person?.id);
  const primaryId = usePrimaryLocationId(person?.id, locations);
  const [selectedId, setSelectedId] = useState<Uuid | null>(null);
  const [locating, setLocating] = useState(false);

  // Saved places obey this device's eye toggles here too, so the chip row and
  // the commute card agree about which pins exist.
  const shownLocations = useMemo(
    () => locations.filter((location) => !hidden.has(location.id)),
    [locations, hidden],
  );

  // "Nobody has looked" and "we looked and failed" are different problems with
  // different buttons — see `pinStatus`.
  const unlocated = useMemo(() => rows.filter((row) => pinStatus(row) === "unplaced"), [rows]);
  const unplaceable = useMemo(() => rows.filter((row) => pinStatus(row) === "failed"), [rows]);
  const selected = rows.find((row) => row.id === selectedId) ?? null;

  /**
   * Locate all. Sequential on purpose: NYC GeoSearch is polite and Nominatim's
   * policy is one request a second (serialised inside `geocode.ts`), so firing
   * sixty at once would only make the queue longer and the failure modes worse.
   *
   * The module-level `geocodeListing` rather than the `useMutations` hook: the
   * hook owns a loading toast per call, which is right for one button on one
   * listing and a toast storm for a batch. One summary at the end instead.
   */
  async function locateAll() {
    if (locating || unlocated.length === 0) return;
    setLocating(true);
    const toastId = toast.loading(`Looking up ${unlocated.length} addresses…`);
    let found = 0;
    let missed = 0;
    for (const row of unlocated) {
      try {
        const result = await geocodeListing(row.id);
        if (result.disabled) {
          // Not "we got through 3 of 60" — the feature does not exist on this
          // deployment, and every remaining call would say the same thing.
          // `break` used to fall through to the summary below, which replaced
          // this toast with "Placed 0 of 3" and hid the only useful sentence.
          toast.error("Maps aren't configured on this deployment.", { id: toastId });
          setLocating(false);
          return;
        }
        if (result.lat == null) missed += 1;
        else found += 1;
      } catch {
        missed += 1;
      }
    }
    await qc.invalidateQueries({ queryKey: queryKeys.listings });
    if (found > 0) {
      toast.success(`Placed ${found} of ${found + missed}`, {
        id: toastId,
        description: missed > 0 ? `${missed} couldn't be placed.` : undefined,
      });
      // One request for every pair that just became computable, rather than one
      // per listing: the route only asks Google about the missing squares.
      void backfillCommutes();
    } else {
      toast.error("Couldn't place any of those.", { id: toastId });
    }
    setLocating(false);
  }

  /**
   * Fill in the commute grid for everything that just got a pin.
   *
   * `/api/commutes` caps itself at `MAX_PAIRS` (300) and at a wall clock, so a
   * batch of freshly placed listings is routinely more than one call's work —
   * and the old single call left the rest until somebody happened to press
   * something. Each pass asks for whatever is still missing.
   *
   * The loop stops when a pass buys nothing (`computed === 0`), which means
   * everything left is already cached, and at five passes regardless: this
   * spends money, and a runaway loop here is the one bug in the app that
   * arrives as an invoice.
   */
  async function backfillCommutes() {
    for (let pass = 1; pass <= MAX_COMMUTE_PASSES; pass += 1) {
      let result;
      try {
        result = await computeCommutes({});
      } catch (error) {
        console.warn("commute backfill failed", error);
        return;
      }
      await qc.invalidateQueries({ queryKey: queryKeys.listings });
      // `skipped` counts *fresh* pairs as well as unreached ones, so it is only
      // a to-do list while the route is still finding work to do.
      if (result.computed === 0 || result.skipped === 0) return;
      if (pass === MAX_COMMUTE_PASSES) {
        toast.info(`${result.skipped} commute times still to work out.`, {
          description: "They fill in next time something is placed, or on Refresh times.",
        });
      }
    }
  }

  return (
    <div className="relative">
      <ListingsMap
        rows={rows}
        locations={shownLocations}
        selectedId={selectedId}
        onSelect={setSelectedId}
        primaryLocationId={primaryId}
        className="h-[calc(100dvh-19rem)] min-h-[380px] md:h-[calc(100dvh-15rem)] md:min-h-[460px]"
        chips={
          <>
            {unlocated.length > 0 && (
              <MapChip
                onClick={() => void locateAll()}
                label="Geocode every listing that has never been looked up"
              >
                <Crosshair className="size-3.5" />
                {locating
                  ? "Locating…"
                  : `${unlocated.length} unlocated · Locate all`}
              </MapChip>
            )}
            {/* The dialog owns its own trigger element; it only has to wear
                the chip's clothes to sit in this row. */}
            <LocationsDialog
              render={
                <Button
                  variant="outline"
                  title="Add or hide saved places"
                  className={cn(MAP_CHIP_CLASS, "border-border bg-card/95")}
                />
              }
            >
              📍 Places
            </LocationsDialog>
          </>
        }
      />

      {/* The ones no provider could place. Not a toast: it is a standing fact
          about the list, and the fix (edit the address) is a click away. */}
      {unplaceable.length > 0 && (
        <div className="mt-2 rounded-2xl border border-border bg-inset p-2 text-xs text-muted-foreground">
          <p className="mb-1 font-extrabold">Couldn&apos;t place:</p>
          <ul className="grid gap-0.5">
            {unplaceable.slice(0, 4).map((row) => (
              <li key={row.id} className="truncate">
                <Link
                  href={`/listings/${row.id}`}
                  className="underline underline-offset-4 hover:text-foreground"
                >
                  {listingLabel(row.address, row.unit)}
                </Link>
              </li>
            ))}
            {unplaceable.length > 4 && <li>+{unplaceable.length - 4} more</li>}
          </ul>
        </div>
      )}

      {selected && (
        <MiniCard listing={selected} onClose={() => setSelectedId(null)} />
      )}
    </div>
  );
}

/** The card a tapped pin raises. Everything the table row says, in one box. */
function MiniCard({ listing, onClose }: { listing: ListingRow; onClose: () => void }) {
  const color = listing.added_by_person?.color ?? "#888";
  return (
    <div
      className="absolute inset-x-2 bottom-2 z-20 grid gap-2 rounded-[20px] border-2 bg-card p-3 shadow-[0_6px_0_rgba(0,0,0,0.35)] md:inset-x-auto md:right-3 md:bottom-3 md:w-80"
      style={{ borderColor: color }}
      role="dialog"
      aria-label={listingLabel(listing.address, listing.unit)}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-[15px] font-black">
            <span className="truncate">{listingLabel(listing.address, listing.unit)}</span>
            <GoneBadge state={listing.listing_state} note={listing.state_note} />
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {[listing.neighborhood, bedsBaths(listing.beds, listing.baths)]
              .filter(Boolean)
              .join(" · ") || "No details yet"}
          </span>
        </span>
        <span className="text-[17px] font-black tabular-nums" style={{ color }}>
          {money(listing.rent) || "—"}
        </span>
      </div>

      <AmenityMarks listing={listing} className="text-xs" />

      <div className="flex items-center justify-between gap-2">
        <VoteChips votes={listing.votes} />
        <PersonDot person={listing.added_by_person} />
      </div>

      <div className="flex items-center gap-2">
        <Link
          href={`/listings/${listing.id}`}
          className="inline-flex h-11 flex-1 items-center justify-center gap-1 rounded-full bg-primary px-4 text-sm font-extrabold text-ink shadow-[0_4px_0_var(--primary-shadow)] active:translate-y-px active:shadow-[0_2px_0_var(--primary-shadow)] md:h-9"
        >
          Open
          <ChevronRight className="size-4" />
        </Link>
        <button
          type="button"
          onClick={onClose}
          className="h-11 rounded-full border-2 border-border px-4 text-sm font-extrabold text-muted-foreground hover:text-foreground md:h-9"
        >
          Close
        </button>
      </div>
    </div>
  );
}
