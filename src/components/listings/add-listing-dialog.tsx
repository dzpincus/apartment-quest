"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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
import {
  BrokerForm,
  brokerPayload,
  type BrokerValues,
} from "@/components/brokers/broker-form";
import { ImportPanel } from "@/components/listings/import-panel";
import {
  AC_OPTIONS,
  DISHWASHER_OPTIONS,
  FEE_OPTIONS,
  GUARANTOR_OPTIONS,
  LAUNDRY_OPTIONS,
  OUTDOOR_OPTIONS,
  PETS_OPTIONS,
  type GuarantorChoice,
} from "@/components/listings/options";
import {
  LISTING_FORM_DEFAULTS,
  listingSchema,
  toListingPatch,
  type ListingFormValues,
} from "@/components/listings/listing-form";
import type { FormKey } from "@/lib/import/coerce";
import type { ImportSuccess } from "@/lib/import/types";
import { savePhotos } from "@/lib/photos-client";
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
import type {
  AcPolicy,
  DishwasherPolicy,
  FeeType,
  LaundryPolicy,
  OutdoorSpacePolicy,
  PetsPolicy,
} from "@/lib/types";

const NEW_BROKER = "__new__";

/** How long an imported field wears its yellow ring. */
const HIGHLIGHT_MS = 3_000;

export function AddListingDialog({ importUrl = null }: { importUrl?: string | null }) {
  // A deep link opens the dialog on arrival; a click opens it on click.
  const [open, setOpen] = useState(Boolean(importUrl));
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus />
        Add listing
      </DialogTrigger>
      {open && <AddListingForm onDone={() => setOpen(false)} importUrl={importUrl} />}
    </Dialog>
  );
}

/**
 * `/listings?import=<url>` — the entry point an iOS share-sheet shortcut will
 * eventually hit. The param is read once, then wiped from the address bar so a
 * reload (or a back/forward) does not re-open the dialog and re-import.
 *
 * `useSearchParams` opts its subtree out of prerendering, which is why the
 * caller wraps this in `<Suspense>` and not the other way round.
 */
export function AddListingDialogWithImport() {
  const params = useSearchParams();
  const router = useRouter();
  const [importUrl] = useState(() => params.get("import"));

  useEffect(() => {
    if (params.get("import")) router.replace("/listings", { scroll: false });
  }, [params, router]);

  return <AddListingDialog importUrl={importUrl} />;
}

/** The trigger button with the deep-link plumbing behind a Suspense boundary. */
export function AddListingDialogSlot() {
  return (
    <Suspense fallback={<AddListingDialog />}>
      <AddListingDialogWithImport />
    </Suspense>
  );
}

function AddListingForm({
  onDone,
  importUrl = null,
}: {
  onDone: () => void;
  importUrl?: string | null;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const { person } = usePerson();
  const { createListing, mergeIntoExisting, createBroker } = useMutations(person?.id);
  const { data: brokers = [] } = useBrokers();

  const [armedKey, setArmedKey] = useState<string | null>(null);
  const [ignoreDupe, setIgnoreDupe] = useState(false);
  const [showBrokerForm, setShowBrokerForm] = useState(false);
  /** Prefill for the inline "+ New broker" panel when an import named an agent
   *  we have never seen. Doubles as the remount key, since `BrokerForm` reads
   *  its defaults once. */
  const [brokerPrefill, setBrokerPrefill] = useState<Partial<BrokerValues> | null>(null);
  /** Keys the import just filled — they wear a yellow ring for a few seconds. */
  const [highlight, setHighlight] = useState<ReadonlySet<FormKey>>(new Set());
  /** Photos ticked in the panel. Saved once the listing exists and has an id. */
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
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

  // The ring is a "look here" nudge, not a state anyone should have to clear.
  useEffect(() => {
    if (highlight.size === 0) return;
    const timer = setTimeout(() => setHighlight(new Set()), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [highlight]);

  /**
   * Fold an import into the form.
   *
   * The rule is: **imported values fill blanks, they never overwrite you.** A
   * field counts as blank when it is empty or still sitting on its default
   * (`fee_type: "unknown"`, `broker_id: "none"`), which is the same definition
   * the rest of the app uses for "nobody has answered this yet". Anything the
   * user typed before hitting Fetch survives.
   *
   * `notes` is the exception and appends instead — the extracted amenities are
   * additional information, not a replacement for whatever was typed.
   */
  function onImportFill(result: ImportSuccess) {
    const current = form.getValues();
    const filled: FormKey[] = [];

    for (const key of Object.keys(result.fields) as FormKey[]) {
      if (key === "notes") continue;
      const value = result.fields[key];
      if (typeof value !== "string" || value.trim() === "") continue;
      const existing = current[key] ?? "";
      const blank = existing.trim() === "" || existing === LISTING_FORM_DEFAULTS[key];
      if (!blank) continue;
      form.setValue(key, value, { shouldDirty: true });
      filled.push(key);
    }

    const importedNotes = result.fields.notes?.trim();
    if (importedNotes) {
      const existing = current.notes.trim();
      const block = `— imported\n${importedNotes}`;
      form.setValue("notes", existing ? `${existing}\n\n${block}` : block, {
        shouldDirty: true,
      });
      filled.push("notes");
    }

    if (result.broker) {
      const wanted = result.broker.name.trim().toLowerCase();
      const match = brokers.find((b) => b.name.trim().toLowerCase() === wanted);
      if (match) {
        form.setValue("broker_id", match.id, { shouldDirty: true });
        filled.push("broker_id");
        setShowBrokerForm(false);
        setBrokerPrefill(null);
      } else {
        // Prefilled, not saved: a broker row is a real record and someone
        // should look at it before it exists.
        setBrokerPrefill(result.broker);
        setShowBrokerForm(true);
      }
    }

    setHighlight(new Set(filled));
    // Re-importing a link somebody already added is the main source of
    // duplicates, and the address only just arrived — check it now.
    armDedupeCheck();
  }

  /** Yellow ring + a hook for anyone reading the DOM. */
  function imported(key: FormKey) {
    return highlight.has(key)
      ? { className: "import-flash", "data-imported": "true" }
      : {};
  }

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
    // Fire-and-forget by design — copying photos off a listing CDN takes
    // seconds and must never hold up the trip to the listing that was just
    // created. `savePhotos` owns its own progress toast, and the detail page
    // grows thumbnails as the rows land over realtime.
    if (photoUrls.length > 0) {
      void savePhotos(listing.id, photoUrls, person?.id ?? null);
    }
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

      <ImportPanel
        initialUrl={importUrl}
        autoFetch={Boolean(importUrl)}
        onFill={onImportFill}
        onPhotosChange={setPhotoUrls}
      />

      <form id="add-listing" onSubmit={form.handleSubmit(onSubmit)} className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
          <Field>
            <FieldLabel htmlFor="address">Address</FieldLabel>
            <Input
              id="address"
              autoFocus
              placeholder="214 Grand St"
              {...imported("address")}
              {...form.register("address", { onBlur: armDedupeCheck })}
            />
            <FieldError errors={[errors.address]} />
          </Field>
          <Field>
            <FieldLabel htmlFor="unit">Unit</FieldLabel>
            <Input
              id="unit"
              placeholder="4B"
              {...imported("unit")}
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
            <Input
              id="neighborhood"
              {...imported("neighborhood")}
              {...form.register("neighborhood")}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="rent">Rent / month</FieldLabel>
            <Input
              id="rent"
              inputMode="numeric"
              {...imported("rent")}
              {...form.register("rent")}
            />
            <FieldError errors={[errors.rent]} />
          </Field>
          <Field>
            <FieldLabel htmlFor="sqft">Sqft</FieldLabel>
            <Input
              id="sqft"
              inputMode="numeric"
              {...imported("sqft")}
              {...form.register("sqft")}
            />
            <FieldError errors={[errors.sqft]} />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-4">
          <Field>
            <FieldLabel htmlFor="beds">Beds</FieldLabel>
            <Input
              id="beds"
              inputMode="decimal"
              {...imported("beds")}
              {...form.register("beds")}
            />
            <FieldError errors={[errors.beds]} />
          </Field>
          <Field>
            <FieldLabel htmlFor="baths">Baths</FieldLabel>
            <Input
              id="baths"
              inputMode="decimal"
              {...imported("baths")}
              {...form.register("baths")}
            />
            <FieldError errors={[errors.baths]} />
          </Field>
          <Field>
            <FieldLabel htmlFor="available_date">Available</FieldLabel>
            <Input
              id="available_date"
              type="date"
              {...imported("available_date")}
              {...form.register("available_date")}
            />
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
                  className={highlight.has("fee_type") ? "import-flash" : undefined}
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
              {...imported("broker_fee_pct")}
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
                  className={highlight.has("guarantor_ok") ? "import-flash" : undefined}
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
                  className={highlight.has("pets") ? "import-flash" : undefined}
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
              {...imported("pet_notes")}
              {...form.register("pet_notes")}
            />
          </Field>
        </div>

        {/* Amenities (0009), one row beside Pets: four selects, all defaulting
            to "Unknown", which the import fills and a human overrides. */}
        <div className="grid gap-3 sm:grid-cols-4">
          <Field>
            <FieldLabel htmlFor="laundry">Laundry</FieldLabel>
            <Controller
              control={form.control}
              name="laundry"
              render={({ field }) => (
                <SimpleSelect<LaundryPolicy>
                  id="laundry"
                  value={field.value}
                  options={LAUNDRY_OPTIONS}
                  onValueChange={field.onChange}
                  className={highlight.has("laundry") ? "import-flash" : undefined}
                  aria-label="Laundry"
                />
              )}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="dishwasher">Dishwasher</FieldLabel>
            <Controller
              control={form.control}
              name="dishwasher"
              render={({ field }) => (
                <SimpleSelect<DishwasherPolicy>
                  id="dishwasher"
                  value={field.value}
                  options={DISHWASHER_OPTIONS}
                  onValueChange={field.onChange}
                  className={highlight.has("dishwasher") ? "import-flash" : undefined}
                  aria-label="Dishwasher"
                />
              )}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="ac">AC</FieldLabel>
            <Controller
              control={form.control}
              name="ac"
              render={({ field }) => (
                <SimpleSelect<AcPolicy>
                  id="ac"
                  value={field.value}
                  options={AC_OPTIONS}
                  onValueChange={field.onChange}
                  className={highlight.has("ac") ? "import-flash" : undefined}
                  aria-label="AC"
                />
              )}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="outdoor_space">Outdoor</FieldLabel>
            <Controller
              control={form.control}
              name="outdoor_space"
              render={({ field }) => (
                <SimpleSelect<OutdoorSpacePolicy>
                  id="outdoor_space"
                  value={field.value}
                  options={OUTDOOR_OPTIONS}
                  onValueChange={field.onChange}
                  className={highlight.has("outdoor_space") ? "import-flash" : undefined}
                  aria-label="Outdoor space"
                />
              )}
            />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="url">Link</FieldLabel>
            <Input
              id="url"
              placeholder="https://…"
              {...imported("url")}
              {...form.register("url")}
            />
            <FieldError errors={[errors.url]} />
          </Field>
          <Field>
            <FieldLabel htmlFor="trains">Trains</FieldLabel>
            <Input
              id="trains"
              placeholder="J M Z"
              {...imported("trains")}
              {...form.register("trains")}
            />
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
                className={highlight.has("broker_id") ? "import-flash" : undefined}
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
            <p className="mb-2 text-sm font-medium">
              {brokerPrefill ? "New broker (from the listing)" : "New broker"}
            </p>
            <BrokerForm
              key={brokerPrefill?.name ?? "blank"}
              initialValues={brokerPrefill ?? undefined}
              submitLabel="Add broker"
              pending={createBroker.isPending}
              onCancel={() => {
                setShowBrokerForm(false);
                setBrokerPrefill(null);
              }}
              onSubmit={async (values) => {
                let broker;
                try {
                  broker = await createBroker.mutateAsync(brokerPayload(values));
                } catch {
                  return; // toasted by `onError`; the sub-form stays open
                }
                form.setValue("broker_id", broker.id);
                setShowBrokerForm(false);
                setBrokerPrefill(null);
                toast.success(`Added broker ${broker.name}`);
              }}
            />
          </div>
        )}

        <Field>
          <FieldLabel htmlFor="notes">Notes</FieldLabel>
          <Textarea
            id="notes"
            rows={3}
            {...imported("notes")}
            {...form.register("notes")}
          />
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
