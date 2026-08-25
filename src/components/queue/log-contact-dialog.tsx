"use client";

/**
 * "Log contact", the one button the whole app is built around.
 *
 * Two steps in one dialog:
 *   1. what happened (kind + optional note) → writes the interaction and bumps
 *      `last_contacted_at`;
 *   2. what happens next — **non-dismissable**. No close button, no
 *      outside-click, no Escape. SPEC: "That prompt is what keeps the whole
 *      system alive. If it is skippable, everything rots." The only way past it
 *      is a next action or admitting the listing is dead (Passed / Lost, which
 *      clears the follow-up fields for you).
 *
 * Same mechanism as the person gate: controlled `open`, `onOpenChange` refuses
 * to close on step 2, `disablePointerDismissal`, `showCloseButton={false}`.
 */

import { useState } from "react";
import { PhoneCall } from "lucide-react";
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
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { SimpleSelect, type SelectOption } from "@/components/simple-select";
import { NextActionForm } from "@/components/queue/next-action-form";
import { usePerson } from "@/lib/person";
import { useMutations } from "@/lib/mutations";
import { INTERACTION_KIND_LABELS, listingLabel } from "@/lib/format";
import type { InteractionKind, Listing, ListingStatus } from "@/lib/types";

export type ContactTarget = Pick<Listing, "id" | "address" | "unit" | "status">;

const KIND_OPTIONS: SelectOption<InteractionKind>[] = (
  Object.keys(INTERACTION_KIND_LABELS) as InteractionKind[]
).map((value) => ({ value, label: INTERACTION_KIND_LABELS[value] }));

export function LogContactDialog({
  listing,
  label = "Log contact",
  variant = "default",
  size = "sm",
  className,
}: {
  listing: ContactTarget;
  label?: string;
  variant?: "default" | "outline" | "secondary" | "ghost";
  size?: "xs" | "sm" | "default";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"log" | "next">("log");

  function close() {
    setOpen(false);
    setStep("log");
  }

  return (
    <Dialog
      open={open}
      // Step 2 swallows every dismissal request (Escape, backdrop, close button).
      onOpenChange={(next) => {
        if (!next && step === "next") return;
        if (next) setStep("log");
        setOpen(next);
      }}
      disablePointerDismissal={step === "next"}
    >
      <DialogTrigger render={<Button variant={variant} size={size} className={className} />}>
        <PhoneCall />
        {label}
      </DialogTrigger>
      {open &&
        (step === "log" ? (
          <LogStep listing={listing} onLogged={() => setStep("next")} onCancel={close} />
        ) : (
          <NextStep listing={listing} onDone={close} />
        ))}
    </Dialog>
  );
}

function LogStep({
  listing,
  onLogged,
  onCancel,
}: {
  listing: ContactTarget;
  onLogged: () => void;
  onCancel: () => void;
}) {
  const { person } = usePerson();
  const { logInteraction } = useMutations(person?.id);
  const [kind, setKind] = useState<InteractionKind>("call");
  const [notes, setNotes] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    await logInteraction.mutateAsync({ listing, kind, notes });
    onLogged();
  }

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Log contact</DialogTitle>
        <DialogDescription>
          {listingLabel(listing.address, listing.unit)}
        </DialogDescription>
      </DialogHeader>

      <form id="log-contact" onSubmit={submit} className="grid gap-3">
        <Field>
          <FieldLabel>What happened?</FieldLabel>
          <SimpleSelect<InteractionKind>
            aria-label="Kind"
            value={kind}
            options={KIND_OPTIONS}
            onValueChange={setKind}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="contact-notes">Notes</FieldLabel>
          <Textarea
            id="contact-notes"
            placeholder="Optional — what they said."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Field>
      </form>

      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" form="log-contact" disabled={logInteraction.isPending}>
          Log
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function NextStep({ listing, onDone }: { listing: ContactTarget; onDone: () => void }) {
  const { person } = usePerson();
  const { setListingStatus } = useMutations(person?.id);
  const [marking, setMarking] = useState(false);

  async function mark(status: ListingStatus) {
    await setListingStatus.mutateAsync({ listing, status });
    onDone();
  }

  return (
    <DialogContent showCloseButton={false} className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>What happens next?</DialogTitle>
        <DialogDescription>
          Every contact needs a next step. That&apos;s what keeps this alive.
        </DialogDescription>
      </DialogHeader>

      <NextActionForm listing={listing} onSaved={onDone} />

      <div className="border-t pt-3">
        {marking ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">Mark it</span>
            <Button
              size="sm"
              variant="outline"
              disabled={setListingStatus.isPending}
              onClick={() => mark("passed")}
            >
              Passed
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={setListingStatus.isPending}
              onClick={() => mark("lost")}
            >
              Lost
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMarking(false)}>
              Back
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setMarking(true)}>
            No follow-up — mark as…
          </Button>
        )}
      </div>
    </DialogContent>
  );
}
