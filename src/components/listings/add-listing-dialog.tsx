"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, TriangleAlert } from "lucide-react";
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
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SimpleSelect, type SelectOption } from "@/components/simple-select";
import { BrokerForm, brokerPayload } from "@/components/brokers/broker-form";
import {
  FEE_OPTIONS,
  GUARANTOR_OPTIONS,
  PETS_OPTIONS,
  type GuarantorChoice,
} from "@/components/listings/options";
import {
  LISTING_FORM_DEFAULTS,
  listingSchema,
  toListingPatch,
  type ListingFormValues,
} from "@/components/listings/listing-form";
import { usePerson } from "@/lib/person";
import { useMutations } from "@/lib/mutations";
import { dedupeKey } from "@/lib/dedupe";
import { listingLabel } from "@/lib/format";
import {
  fetchListingByDedupeKey,
  queryKeys,
  useBrokers,
  useListingByDedupeKey,
} from "@/lib/queries";
import type { FeeType, PetsPolicy } from "@/lib/types";

const NEW_BROKER = "__new__";

export function AddListingDialog() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus />
        Add listing
      </DialogTrigger>
      {open && <AddListingForm onDone={() => setOpen(false)} />}
    </Dialog>
  );
}

function AddListingForm({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { person } = usePerson();
  const { createListing, mergeIntoExisting, createBroker } = useMutations(person?.id);
  const { data: brokers = [] } = useBrokers();

  const [armedKey, setArmedKey] = useState<string | null>(null);
  const [ignoreDupe, setIgnoreDupe] = useState(false);
  const [showBrokerForm, setShowBrokerForm] = useState(false);
  const dupeRef = useRef<HTMLDivElement>(null);
  /** Bumped by a blocked submit; the effect below is what actually scrolls. */
  const [scrollNonce, setScrollNonce] = useState(0);

  const form = useForm<ListingFormValues>({
    resolver: zodResolver(listingSchema),
    defaultValues: LISTING_FORM_DEFAULTS,
  });
  const { errors } = form.formState;

  const dupeQuery = useListingByDedupeKey(armedKey ?? "", {
    enabled: Boolean(armedKey) && !ignoreDupe,
  });
  const duplicate = ignoreDupe ? null : (dupeQuery.data ?? null);

  // The warning renders below the address row and the dialog scrolls, so on a
  // long form a blocked submit could otherwise look like a dead button.
  //
  // Keyed on both the nonce and the row: the warning may already be mounted
  // (the blur check found it first) or may only mount once the submit-time
  // lookup resolves, and this fires in either order. Nothing is set here —
  // a `setState` in an effect body is a cascading render.
  useEffect(() => {
    if (scrollNonce === 0 || !duplicate) return;
    dupeRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [scrollNonce, duplicate]);

  /**
   * Arm the dedupe lookup on blur so it is not one request per keystroke.
   *
   * Also un-latches "Add anyway": that was a decision about the address it was
   * clicked for, and leaving it set meant the *next* address typed into the
   * same open dialog was inserted with no dupe check at all. Compared by key
   * rather than by keystroke — `form.watch()` would make the React Compiler
   * skip memoizing this whole component.
   */
  function armDedupeCheck() {
    const { address, unit } = form.getValues();
    if (!address.trim()) return;
    const key = dedupeKey(address, unit);
    if (key !== armedKey) setIgnoreDupe(false);
    setArmedKey(key);
  }

  const brokerOptions: SelectOption[] = [
    { value: "none", label: "No broker" },
    ...brokers.map((b) => ({
      value: b.id,
      label: b.company ? `${b.name} — ${b.company}` : b.name,
    })),
    { value: NEW_BROKER, label: "+ New broker" },
  ];

  async function onSubmit(values: ListingFormValues) {
    const patch = toListingPatch(values);
    const key = dedupeKey(values.address, values.unit);

    // The blur handler already re-arms on a changed address, but clicking
    // submit blurs and submits in the same batch, so `ignoreDupe` here can
    // still be the previous render's answer. Scope the override to the exact
    // key it was granted for and the race stops mattering.
    const override = ignoreDupe && key === armedKey;

    if (!override) {
      if (ignoreDupe) setIgnoreDupe(false);
      const existing = await qc.fetchQuery({
        queryKey: queryKeys.listingByDedupeKey(key),
        queryFn: () => fetchListingByDedupeKey(key),
      });
      setArmedKey(key);
      if (existing) {
        // The warning below now renders and the user picks a path. Say so:
        // silently swallowing the submit reads as a broken button.
        toast.info(`${listingLabel(existing.address, existing.unit)} is already on the board.`);
        setScrollNonce((n) => n + 1);
        return;
      }
    }

    let listing;
    try {
      listing = await createListing.mutateAsync(patch);
    } catch {
      return; // toasted by `onError`; the form keeps everything that was typed
    }
    toast.success(`Added ${listingLabel(listing.address, listing.unit)}`);
    onDone();
    router.push(`/listings/${listing.id}`);
  }

  async function onMerge() {
    if (!duplicate) return;
    const patch = toListingPatch(form.getValues());
    let merged;
    try {
      merged = await mergeIntoExisting.mutateAsync({ existing: duplicate, patch });
    } catch {
      return; // toasted by `onError`
    }
    toast.success(`Merged into ${listingLabel(merged.address, merged.unit)}`);
    onDone();
    router.push(`/listings/${merged.id}`);
  }

  const pending =
    createListing.isPending || mergeIntoExisting.isPending || form.formState.isSubmitting;

  return (
    <DialogContent className="max-h-[90dvh] w-full overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>Add listing</DialogTitle>
        <DialogDescription>
          Paste in what you found. Only the address is required.
        </DialogDescription>
      </DialogHeader>

      <form id="add-listing" onSubmit={form.handleSubmit(onSubmit)} className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
          <Field>
            <FieldLabel htmlFor="address">Address</FieldLabel>
            <Input
              id="address"
              autoFocus
              placeholder="214 Grand St"
              {...form.register("address", { onBlur: armDedupeCheck })}
            />
            <FieldError errors={[errors.address]} />
          </Field>
          <Field>
            <FieldLabel htmlFor="unit">Unit</FieldLabel>
            <Input
              id="unit"
              placeholder="4B"
              {...form.register("unit", { onBlur: armDedupeCheck })}
            />
          </Field>
        </div>

        {duplicate && (
          <div
            ref={dupeRef}
            className="flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3"
          >
            <p className="flex items-start gap-2 text-sm">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
              <span>
                This looks like a listing{" "}
                <strong>{duplicate.added_by_person?.name ?? "someone"}</strong> already
                added:{" "}
                <Link
                  href={`/listings/${duplicate.id}`}
                  className="underline underline-offset-4"
                >
                  {listingLabel(duplicate.address, duplicate.unit)}
                </Link>
                .
              </span>
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={onMerge} disabled={pending}>
                Merge into it
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setIgnoreDupe(true)}
              >
                Add anyway
              </Button>
            </div>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <Field>
            <FieldLabel htmlFor="neighborhood">Neighborhood</FieldLabel>
            <Input id="neighborhood" {...form.register("neighborhood")} />
          </Field>
          <Field>
            <FieldLabel htmlFor="rent">Rent / month</FieldLabel>
            <Input id="rent" inputMode="numeric" {...form.register("rent")} />
            <FieldError errors={[errors.rent]} />
          </Field>
          <Field>
            <FieldLabel htmlFor="sqft">Sqft</FieldLabel>
            <Input id="sqft" inputMode="numeric" {...form.register("sqft")} />
            <FieldError errors={[errors.sqft]} />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-4">
          <Field>
            <FieldLabel htmlFor="beds">Beds</FieldLabel>
            <Input id="beds" inputMode="decimal" {...form.register("beds")} />
            <FieldError errors={[errors.beds]} />
          </Field>
          <Field>
            <FieldLabel htmlFor="baths">Baths</FieldLabel>
            <Input id="baths" inputMode="decimal" {...form.register("baths")} />
            <FieldError errors={[errors.baths]} />
          </Field>
          <Field>
            <FieldLabel htmlFor="available_date">Available</FieldLabel>
            <Input id="available_date" type="date" {...form.register("available_date")} />
          </Field>
          <Field>
            <FieldLabel htmlFor="income_multiplier">Income x</FieldLabel>
            <Input
              id="income_multiplier"
              inputMode="decimal"
              {...form.register("income_multiplier")}
            />
            <FieldError errors={[errors.income_multiplier]} />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field>
            <FieldLabel>Fee</FieldLabel>
            <Controller
              control={form.control}
              name="fee_type"
              render={({ field }) => (
                <SimpleSelect<FeeType>
                  value={field.value}
                  options={FEE_OPTIONS}
                  onValueChange={field.onChange}
                  aria-label="Fee type"
                />
              )}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="broker_fee_pct">Broker fee %</FieldLabel>
            <Input
              id="broker_fee_pct"
              inputMode="decimal"
              {...form.register("broker_fee_pct")}
            />
            <FieldError errors={[errors.broker_fee_pct]} />
          </Field>
          <Field>
            <FieldLabel>Guarantor</FieldLabel>
            <Controller
              control={form.control}
              name="guarantor_ok"
              render={({ field }) => (
                <SimpleSelect<GuarantorChoice>
                  value={field.value}
                  options={GUARANTOR_OPTIONS}
                  onValueChange={field.onChange}
                  aria-label="Guarantor"
                />
              )}
            />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
          <Field>
            <FieldLabel htmlFor="pets">Pets</FieldLabel>
            <Controller
              control={form.control}
              name="pets"
              render={({ field }) => (
                <SimpleSelect<PetsPolicy>
                  id="pets"
                  value={field.value}
                  options={PETS_OPTIONS}
                  onValueChange={field.onChange}
                  aria-label="Pets"
                />
              )}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="pet_notes">Pet notes</FieldLabel>
            <Input
              id="pet_notes"
              placeholder="e.g. under 25 lb, $500 deposit"
              {...form.register("pet_notes")}
            />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="url">Link</FieldLabel>
            <Input id="url" placeholder="https://…" {...form.register("url")} />
            <FieldError errors={[errors.url]} />
          </Field>
          <Field>
            <FieldLabel htmlFor="trains">Trains</FieldLabel>
            <Input id="trains" placeholder="J M Z" {...form.register("trains")} />
          </Field>
        </div>

        <Field>
          <FieldLabel>Broker</FieldLabel>
          <Controller
            control={form.control}
            name="broker_id"
            render={({ field }) => (
              <SimpleSelect
                value={field.value}
                options={brokerOptions}
                aria-label="Broker"
                onValueChange={(value) => {
                  if (value === NEW_BROKER) {
                    setShowBrokerForm(true);
                    return;
                  }
                  setShowBrokerForm(false);
                  field.onChange(value);
                }}
              />
            )}
          />
        </Field>

        {showBrokerForm && (
          <div className="rounded-lg border p-3">
            <p className="mb-2 text-sm font-medium">New broker</p>
            <BrokerForm
              submitLabel="Add broker"
              pending={createBroker.isPending}
              onCancel={() => setShowBrokerForm(false)}
              onSubmit={async (values) => {
                let broker;
                try {
                  broker = await createBroker.mutateAsync(brokerPayload(values));
                } catch {
                  return; // toasted by `onError`; the sub-form stays open
                }
                form.setValue("broker_id", broker.id);
                setShowBrokerForm(false);
                toast.success(`Added broker ${broker.name}`);
              }}
            />
          </div>
        )}

        <Field>
          <FieldLabel htmlFor="notes">Notes</FieldLabel>
          <Textarea id="notes" rows={3} {...form.register("notes")} />
        </Field>
      </form>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" form="add-listing" disabled={pending}>
          {ignoreDupe ? "Add anyway" : "Add listing"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
