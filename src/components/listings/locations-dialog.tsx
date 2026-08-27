"use client";

/**
 * The saved places, managed in one box.
 *
 * The list is shared — one hunt, one list, so anybody can delete anybody's
 * place, exactly like anybody can edit anybody's listing. What is *not* shared
 * is which of them you want to look at: the eye and the star write to
 * `src/lib/prefs.ts` (localStorage, per person, per device) and never touch a
 * row, so turning the gym off here does not turn it off on somebody else's
 * phone.
 *
 * Adding is a two-step conversation because `locations.lat/lng` are NOT NULL:
 * the address is geocoded on blur, the coordinates come back as a preview, and
 * "Add place" is only offered once there is a pin to save. Cheap — the preview
 * writes nothing — and it means a typo is caught before it becomes a column of
 * wrong commute times.
 */

import { useEffect, useState } from "react";
import { Eye, EyeOff, MapPin, Plus, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PersonDot } from "@/components/person-dot";
import { useLocations } from "@/lib/queries";
import { usePerson } from "@/lib/person";
import { useMutations } from "@/lib/mutations";
import {
  toggleLocationHidden,
  setPrimaryLocation,
  useHiddenLocationIds,
  usePrimaryLocationId,
} from "@/lib/prefs";
import { cn } from "@/lib/utils";
import type { Location } from "@/lib/types";

/** What the preview came back with, and whether it is worth trusting. */
type Preview = {
  lat: number;
  lng: number;
  lowConfidence: boolean;
  address: string;
} | null;

export function LocationsDialog({
  render,
  children,
}: {
  /** The trigger element — a chip on the map, a button on the detail card. */
  render?: React.ReactElement<Record<string, unknown>>;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={render ?? <Button variant="outline" size="sm" />}>
        {children ?? (
          <>
            <MapPin />
            Manage locations
          </>
        )}
      </DialogTrigger>
      {open && <LocationsDialogBody />}
    </Dialog>
  );
}

function LocationsDialogBody() {
  const { person, people } = usePerson();
  const { data: locations = [] } = useLocations();
  const hidden = useHiddenLocationIds(person?.id);
  // The loaded list is the authority: a star pointing at a place somebody else
  // deleted must not light up a row that no longer exists.
  const primaryId = usePrimaryLocationId(person?.id, locations);

  return (
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Saved places</DialogTitle>
        <DialogDescription>
          Shared with everyone. The eye and the star are yours alone — they live on
          this device.
        </DialogDescription>
      </DialogHeader>

      {locations.length === 0 ? (
        <p className="rounded-2xl border-2 border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          Add a place you go a lot — work, gym, the good bagel spot.
        </p>
      ) : (
        <ul className="grid gap-1.5">
          {locations.map((location) => (
            <LocationRow
              key={location.id}
              location={location}
              hidden={hidden.has(location.id)}
              primary={primaryId === location.id}
              addedBy={people.find((p) => p.id === location.added_by) ?? null}
            />
          ))}
        </ul>
      )}

      <AddLocationForm />
    </DialogContent>
  );
}

function LocationRow({
  location,
  hidden,
  primary,
  addedBy,
}: {
  location: Location;
  hidden: boolean;
  primary: boolean;
  addedBy: Parameters<typeof PersonDot>[0]["person"];
}) {
  const { person } = usePerson();
  const { deleteLocation } = useMutations(person?.id);
  const [confirming, setConfirming] = useState(false);

  /**
   * "Sure?" stands down after four seconds.
   *
   * A row armed by a mis-tap used to stay armed for as long as the dialog was
   * open, so the *next* deliberate tap in that row — aimed at the eye or the
   * star, which sit right beside it — could land on a live delete button.
   * These rows are shared data with no undo and no per-person boundary, so the
   * dangerous state is the one that should expire on its own.
   */
  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), 4_000);
    return () => clearTimeout(timer);
  }, [confirming]);

  return (
    <li className="flex items-center gap-2 rounded-2xl bg-inset p-2">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full border-2 border-primary/40 text-base">
        {location.emoji?.trim() || "★"}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-sm font-extrabold">
          <span className="truncate">{location.name}</span>
          <PersonDot person={addedBy} title={`Added by ${addedBy?.name ?? "someone"}`} />
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {location.address}
        </span>
      </span>

      <IconToggle
        on={!hidden}
        label={hidden ? `Show ${location.name}` : `Hide ${location.name}`}
        onClick={() => person && toggleLocationHidden(person.id, location.id)}
      >
        {hidden ? <EyeOff /> : <Eye />}
      </IconToggle>

      <IconToggle
        on={primary}
        label={primary ? `Unstar ${location.name}` : `Star ${location.name}`}
        onClick={() => person && setPrimaryLocation(person.id, location.id)}
      >
        <Star className={primary ? "fill-current" : undefined} />
      </IconToggle>

      {confirming ? (
        <Button
          variant="destructive"
          size="sm"
          className="h-11 md:h-9"
          onClick={() => deleteLocation.mutate(location)}
        >
          Sure?
        </Button>
      ) : (
        <IconToggle label={`Remove ${location.name}`} onClick={() => setConfirming(true)}>
          <Trash2 />
        </IconToggle>
      )}
    </li>
  );
}

/** 44px, square, and it says what it does — three of these sit in a row. */
function IconToggle({
  on,
  label,
  onClick,
  children,
}: {
  on?: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      aria-pressed={on}
      title={label}
      onClick={onClick}
      className={cn("size-11 shrink-0 md:size-9", on && "text-primary")}
    >
      {children}
    </Button>
  );
}

function AddLocationForm() {
  const { person } = usePerson();
  const { createLocation, geocodeAddressPreview } = useMutations(person?.id);
  const [emoji, setEmoji] = useState("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [preview, setPreview] = useState<Preview>(null);
  const [notFound, setNotFound] = useState(false);

  const previewing = geocodeAddressPreview.isPending;
  // The preview is only about the address in the box: editing it after a
  // lookup must not let a stale pin be saved under a new street.
  const fresh = preview !== null && preview.address === address.trim();

  async function lookUp() {
    const typed = address.trim();
    if (typed === "" || (preview && preview.address === typed)) return;
    setNotFound(false);
    setPreview(null);
    const result = await geocodeAddressPreview.mutateAsync({ address: typed }).catch(() => null);
    if (!result || result.lat == null || result.lng == null) {
      setNotFound(true);
      return;
    }
    setPreview({
      lat: result.lat,
      lng: result.lng,
      lowConfidence: result.lowConfidence,
      address: typed,
    });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!fresh || !preview || name.trim() === "") return;
    try {
      // The commute backfill for the new column is `createLocation`'s own job
      // (`mutations.ts`) — it is the one call in the app that spends Google
      // quota on purpose, and it must fire exactly once.
      await createLocation.mutateAsync({
        name: name.trim(),
        address: preview.address,
        lat: preview.lat,
        lng: preview.lng,
        emoji: emoji.trim() || null,
      });
    } catch {
      return; // Toasted by `onError`; the typed values stay put.
    }
    setEmoji("");
    setName("");
    setAddress("");
    setPreview(null);
  }

  return (
    <form onSubmit={submit} className="grid gap-2 rounded-2xl border-2 border-border p-3">
      <p className="text-sm font-extrabold">Add a place</p>
      <div className="flex gap-2">
        <Field className="w-16 shrink-0">
          <FieldLabel htmlFor="location-emoji">Glyph</FieldLabel>
          <Input
            id="location-emoji"
            value={emoji}
            maxLength={2}
            placeholder="🏢"
            className="text-center"
            onChange={(e) => setEmoji(e.target.value)}
          />
        </Field>
        <Field className="flex-1">
          <FieldLabel htmlFor="location-name">Name</FieldLabel>
          <Input
            id="location-name"
            value={name}
            placeholder="Reese's office"
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
      </div>
      <Field>
        <FieldLabel htmlFor="location-address">Address</FieldLabel>
        <Input
          id="location-address"
          value={address}
          placeholder="195 Broadway, New York, NY"
          onChange={(e) => {
            setAddress(e.target.value);
            setNotFound(false);
          }}
          onBlur={() => void lookUp()}
        />
      </Field>

      <p className="min-h-5 text-xs text-muted-foreground" aria-live="polite">
        {previewing && "Looking that up…"}
        {!previewing && notFound && "Couldn't place that address. Try adding the borough."}
        {!previewing && fresh && preview && (
          <>
            Found it at {preview.lat.toFixed(5)}, {preview.lng.toFixed(5)} — looks right?
            {preview.lowConfidence && (
              <span className="text-due"> ⚠ It was a guess; a borough or ZIP would help.</span>
            )}
          </>
        )}
      </p>

      <Button
        type="submit"
        size="lg"
        className="justify-self-start"
        disabled={!fresh || name.trim() === "" || createLocation.isPending}
      >
        <Plus />
        Add place
      </Button>
    </form>
  );
}
