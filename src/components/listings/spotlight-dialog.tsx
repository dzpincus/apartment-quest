"use client";

/**
 * "Look at this one!" — the button on a listing's header and the dialog behind
 * it (0012).
 *
 * One spotlight per person, so this is a two-state control: **Look at this
 * one!** when the slot is free or pointed elsewhere, **Spotlighted** (pressed)
 * when it is already on this listing. Both open the same dialog; the second one
 * arrives with the note already in the box and a way to take it down.
 *
 * The line that matters is "This replaces your spotlight on X" — the whole
 * feature is that there is only ever one, and finding that out *after* saving
 * would be the app quietly deleting something somebody wrote.
 */

import { useState } from "react";
import { toast } from "sonner";
import { Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { usePerson } from "@/lib/person";
import { useMutations } from "@/lib/mutations";
import { useListings, type ListingRow } from "@/lib/queries";
import { SPOTLIGHT_NOTE_MAX, mySpotlight } from "@/lib/spotlight";
import { listingLabel } from "@/lib/format";
import type { Listing } from "@/lib/types";

/** Everything either half of this file needs off the row. */
type Target = Pick<Listing, "id" | "address" | "unit">;

export function SpotlightDialog({ listing }: { listing: ListingRow }) {
  const [open, setOpen] = useState(false);
  const { person } = usePerson();
  // `["listings"]` is already in the cache on every screen in the app — the nav
  // badge holds it — so this is a read, not a second request. It answers only
  // one question: where *else* is my spotlight, so the dialog can say what it
  // is about to replace.
  const { data: listings } = useListings();
  // Whether it is on *this* listing is answered by the row itself, which is
  // authoritative even for a merged row that `useListings()` filters out.
  const own = (listing.spotlights ?? []).find((s) => s.person_id === person?.id);
  const isMine = Boolean(own);
  const existing = own
    ? { listing, note: own.note?.trim() || null }
    : mySpotlight(listings, person?.id);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        // Pressed rather than a different button: it is the same control in its
        // other state, and a screen reader should hear that rather than hear
        // two buttons that come and go.
        aria-pressed={isMine}
        render={
          <Button
            variant={isMine ? "default" : "outline"}
            size="sm"
            disabled={!person}
            title={
              person
                ? undefined
                : "Pick who you are first — a spotlight is signed."
            }
          />
        }
      >
        <Megaphone />
        {isMine ? "Spotlighted" : "Look at this one!"}
      </DialogTrigger>
      {open && (
        <SpotlightForm
          listing={listing}
          // Read fresh on every render above, and the form is remounted (by
          // `open &&`) each time the dialog opens, so the note in the box is
          // never a stale one from a previous visit.
          existing={existing ?? null}
          onDone={() => setOpen(false)}
        />
      )}
    </Dialog>
  );
}

function SpotlightForm({
  listing,
  existing,
  onDone,
}: {
  listing: ListingRow;
  existing: { listing: Pick<ListingRow, "id" | "address" | "unit">; note: string | null } | null;
  onDone: () => void;
}) {
  const { person } = usePerson();
  const { setSpotlight, clearSpotlight } = useMutations(person?.id);
  const isMine = existing?.listing.id === listing.id;
  const [note, setNote] = useState(isMine ? (existing?.note ?? "") : "");

  const label = listingLabel(listing.address, listing.unit);
  const pending = setSpotlight.isPending || clearSpotlight.isPending;
  // Somewhere else, and therefore about to be replaced. Same listing is not a
  // replacement, it is an edit.
  const replaces =
    existing && !isMine
      ? listingLabel(existing.listing.address, existing.listing.unit)
      : null;

  const target: Target = { id: listing.id, address: listing.address, unit: listing.unit };

  async function save() {
    try {
      await setSpotlight.mutateAsync({ listing: target, note: note.trim() || null });
    } catch {
      // Toasted by `onError`; this guard is what keeps the success toast and
      // the close below from firing on a write that never landed.
      return;
    }
    toast.success(isMine ? "Spotlight updated" : `Everyone will see ${label}`);
    onDone();
  }

  async function remove() {
    try {
      await clearSpotlight.mutateAsync(target);
    } catch {
      return;
    }
    toast.success("Spotlight removed");
    onDone();
  }

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Look at this one! 👀</DialogTitle>
        <DialogDescription>
          {label} goes to the top of everyone&apos;s home screen with what you say
          below.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-1.5">
        <label htmlFor="spotlight-note" className="text-sm font-extrabold">
          Why should everyone look?
        </label>
        <Textarea
          id="spotlight-note"
          autoFocus
          rows={3}
          maxLength={SPOTLIGHT_NOTE_MAX}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Great light, no fee, and it's four blocks from the L"
          className="text-base"
        />
        <p className="text-xs text-faint tabular-nums">
          {note.trim().length}/{SPOTLIGHT_NOTE_MAX}
        </p>
        {replaces && (
          // Said before the button is pressed, never after: one per person, and
          // somebody typed the note this is about to replace.
          <p className="text-xs text-muted-foreground">
            This replaces your spotlight on {replaces}.
          </p>
        )}
      </div>

      <DialogFooter>
        {/* Only when there is one to remove, and only on the listing it is
            actually on — "Remove spotlight" on a different listing would be a
            button that deletes something not on screen. */}
        {isMine && (
          <Button
            variant="ghost"
            disabled={pending}
            onClick={remove}
            className="text-destructive hover:bg-destructive/15 hover:text-destructive sm:mr-auto"
          >
            Remove spotlight
          </Button>
        )}
        <Button variant="outline" disabled={pending} onClick={onDone}>
          Cancel
        </Button>
        <Button disabled={pending} onClick={save}>
          <Megaphone />
          {isMine ? "Save" : "Spotlight it"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
