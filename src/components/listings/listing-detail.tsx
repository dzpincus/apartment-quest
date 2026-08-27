"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { InlineEdit, toNumberOrNull, toTextOrNull } from "@/components/inline-edit";
import { SimpleSelect } from "@/components/simple-select";
import { PersonDot } from "@/components/person-dot";
import { UnreadBadge } from "@/components/unread-badge";
import { Thread } from "@/components/chat/thread";
import { BrokerCard } from "@/components/listings/broker-card";
import { CommuteCard } from "@/components/listings/commute-card";
import { InteractionsCard } from "@/components/listings/interactions-card";
import { NextActionCard } from "@/components/listings/next-action-card";
import { MergeIntoDialog } from "@/components/listings/merge-into-dialog";
import { PhotoGallery } from "@/components/listings/photo-gallery";
import { LinkStatus } from "@/components/listings/link-status";
import { QualifyBadge } from "@/components/listings/qualify-badge";
import { StatusSelect } from "@/components/listings/status-select";
import { VotesCard } from "@/components/listings/votes-card";
import {
  AC_OPTIONS,
  DISHWASHER_OPTIONS,
  FEE_OPTIONS,
  GUARANTOR_OPTIONS,
  LAUNDRY_OPTIONS,
  OUTDOOR_OPTIONS,
  PETS_OPTIONS,
  choiceToGuarantor,
  guarantorToChoice,
  type GuarantorChoice,
} from "@/components/listings/options";
import { URL_RE } from "@/components/listings/listing-form";
import { useRowEdit } from "@/components/listings/use-row-edit";
import { useListing, useUnread } from "@/lib/queries";
import { usePerson } from "@/lib/person";
import { humans } from "@/lib/people";
import { listingLabel, money } from "@/lib/format";
import { fmtDay, fmtNY } from "@/lib/time";
import type {
  AcPolicy,
  DishwasherPolicy,
  FeeType,
  LaundryPolicy,
  OutdoorSpacePolicy,
  PetsPolicy,
  Uuid,
} from "@/lib/types";

export function ListingDetail({ id }: { id: Uuid }) {
  const { people } = usePerson();
  const { data: listing, isPending, error } = useListing(id);

  if (isPending) return <Skeleton className="h-64 w-full" />;
  if (error) {
    return (
      <p className="text-sm text-destructive">
        Could not load this listing: {String((error as Error).message)}
      </p>
    );
  }
  if (!listing) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">This listing no longer exists.</p>
        <Link href="/listings" className="text-sm underline underline-offset-4">
          Back to listings
        </Link>
      </div>
    );
  }

  return (
    <ListingDetailView
      key={listing.id}
      listing={listing}
      // Quest Bot is a row in `people` (0006) with an income of 0; the
      // qualification math counts housemates, so it is filtered, not relied on.
      incomes={humans(people).map((p) => p.annual_income)}
    />
  );
}

function ListingDetailView({
  listing,
  incomes,
}: {
  listing: NonNullable<ReturnType<typeof useListing>["data"]>;
  incomes: ReadonlyArray<number | null | undefined>;
}) {
  const save = useRowEdit(listing);
  const mergedInto = useListing(listing.merged_into ?? undefined);
  const unread = useUnread();

  /**
   * The browser cannot honour `#thread` itself: this view mounts only once the
   * listing query resolves, long after the navigation, so the anchor does not
   * exist at the moment Next would have scrolled to it. Scrolling here — on
   * the first render that has a DOM node — is what makes the feed's "messaged
   * about ..." link land on the conversation. Marking read is not our job:
   * `Thread` does it on mount, which is exactly when this fires.
   */
  const threadRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (window.location.hash !== "#thread") return;
    const el = threadRef.current;
    if (!el) return;
    // A frame late on purpose: the photo strip above settles its height first,
    // and scrolling before it does lands short of the card.
    const timer = setTimeout(
      () => el.scrollIntoView({ behavior: "smooth", block: "start" }),
      60,
    );
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="space-y-4">
      {listing.merged_into && (
        <div className="rounded-2xl border-2 border-due/50 bg-due/10 p-3 text-sm">
          Merged into{" "}
          <Link
            href={`/listings/${listing.merged_into}`}
            className="font-medium underline underline-offset-4"
          >
            {mergedInto.data
              ? listingLabel(mergedInto.data.address, mergedInto.data.unit)
              : "the surviving listing"}
          </Link>
          . This copy is hidden from the table.
        </div>
      )}

      {/* The rule under the header is the colour of whoever found this, with
          the credit line to decode it — same rule as the listing cards. */}
      <div
        className="flex flex-wrap items-start justify-between gap-2 border-b-2 pb-3"
        style={{ borderColor: listing.added_by_person?.color ?? "#888" }}
      >
        <div className="min-w-0">
          <Link
            href="/listings"
            className="text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            ← Listings
          </Link>
          <p className="mt-1 flex items-center gap-2 text-xs font-extrabold">
            <PersonDot
              person={listing.added_by_person}
              withName={false}
              size="md"
            />
            <span style={{ color: listing.added_by_person?.color ?? undefined }}>
              {listing.added_by_person?.name ?? "Someone"} found this ·{" "}
              {listing.created_at ? fmtNY(listing.created_at, "MMM d") : "—"}
            </span>
          </p>
          <h1 className="flex items-center gap-2 text-[26px] leading-tight md:text-2xl">
            <span className="truncate">
              {listingLabel(listing.address, listing.unit)}
            </span>
            {/* Clears itself: the thread below marks itself read on mount. */}
            <UnreadBadge count={unread.byListing[listing.id] ?? 0} />
          </h1>
          <p className="text-sm text-muted-foreground">
            {listing.neighborhood ?? "No neighborhood"} ·{" "}
            {listing.rent == null ? "no rent" : `${money(listing.rent)}/mo`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <QualifyBadge
            rent={listing.rent}
            incomeMultiplier={listing.income_multiplier}
            incomes={incomes}
          />
          <StatusSelect listing={listing} size="default" className="w-40" />
          {/* Only http(s) becomes a link. Rows predating the inline-edit
              validation below can still hold anything, and `href` is the one
              place a stored string turns into executable intent. */}
          {listing.url && /^https?:\/\//i.test(listing.url) && (
            <Button variant="outline" size="sm" render={<a href={listing.url} target="_blank" rel="noreferrer" />}>
              <ExternalLink />
              Open
            </Button>
          )}
          {/* Merging a row that is already merged builds a chain the banner
              above only follows one hop of; the RPC now refuses it too. */}
          {!listing.merged_into && <MergeIntoDialog listing={listing} />}
        </div>

        {/* Votes live in the header, directly under the CTA row: "what does
            everyone think" is a header question, and burying it below the
            thread meant scrolling past every field to answer it. `compact`
            drops the Card chrome so this is one flat section on the same
            surface, not a card inside a header. `w-full` is what makes the
            flex-wrap above give it its own full-width line. */}
        <VotesCard listing={listing} compact className="w-full" />
      </div>

      {/* Above the fields: what the place looks like is the first question
          anyone asks, and the answer should not be below "Broker fee %". */}
      <PhotoGallery listing={listing} />

      <Card>
        <CardContent>
          <dl className="grid gap-x-8 md:grid-cols-2">
            <DetailField label="Address">
              <InlineEdit
                label="address"
                value={listing.address}
                onSave={(raw) => raw && save({ address: raw })}
              />
            </DetailField>
            <DetailField label="Unit">
              <InlineEdit
                label="unit"
                value={listing.unit}
                onSave={(raw) => save({ unit: toTextOrNull(raw) })}
              />
            </DetailField>
            <DetailField label="Neighborhood">
              <InlineEdit
                label="neighborhood"
                value={listing.neighborhood}
                onSave={(raw) => save({ neighborhood: toTextOrNull(raw) })}
              />
            </DetailField>
            <DetailField label="Rent">
              <InlineEdit
                label="rent"
                type="number"
                value={listing.rent}
                display={listing.rent == null ? undefined : money(listing.rent)}
                onSave={(raw) => save({ rent: toNumberOrNull(raw) })}
              />
            </DetailField>
            <DetailField label="Beds">
              <InlineEdit
                label="beds"
                type="number"
                value={listing.beds}
                onSave={(raw) => save({ beds: toNumberOrNull(raw) })}
              />
            </DetailField>
            <DetailField label="Baths">
              <InlineEdit
                label="baths"
                type="number"
                value={listing.baths}
                onSave={(raw) => save({ baths: toNumberOrNull(raw) })}
              />
            </DetailField>
            <DetailField label="Sqft">
              <InlineEdit
                label="sqft"
                type="number"
                value={listing.sqft}
                onSave={(raw) => save({ sqft: toNumberOrNull(raw) })}
              />
            </DetailField>
            <DetailField label="Available">
              <InlineEdit
                label="available date"
                type="date"
                value={listing.available_date}
                display={
                  listing.available_date ? fmtDay(listing.available_date, "MMM d, yyyy") : undefined
                }
                onSave={(raw) => save({ available_date: toTextOrNull(raw) })}
              />
            </DetailField>
            <DetailField label="Fee">
              <SimpleSelect<FeeType>
                size="sm"
                className="w-40"
                aria-label="Fee type"
                value={listing.fee_type ?? "unknown"}
                options={FEE_OPTIONS}
                onValueChange={(fee_type) => save({ fee_type })}
              />
            </DetailField>
            <DetailField label="Broker fee %">
              <InlineEdit
                label="broker fee"
                type="number"
                value={listing.broker_fee_pct}
                onSave={(raw) => save({ broker_fee_pct: toNumberOrNull(raw) })}
              />
            </DetailField>
            <DetailField label="Guarantor">
              <SimpleSelect<GuarantorChoice>
                size="sm"
                className="w-40"
                aria-label="Guarantor"
                value={guarantorToChoice(listing.guarantor_ok)}
                options={GUARANTOR_OPTIONS}
                onValueChange={(choice) =>
                  save({ guarantor_ok: choiceToGuarantor(choice) })
                }
              />
            </DetailField>
            <DetailField label="Pets">
              <SimpleSelect<PetsPolicy>
                size="sm"
                className="w-40"
                aria-label="Pets"
                value={listing.pets ?? "unknown"}
                options={PETS_OPTIONS}
                onValueChange={(pets) => save({ pets })}
              />
            </DetailField>
            <DetailField label="Pet notes">
              <InlineEdit
                label="pet notes"
                value={listing.pet_notes}
                placeholder="e.g. under 25 lb, $500 deposit"
                onSave={(raw) => save({ pet_notes: toTextOrNull(raw) })}
              />
            </DetailField>
            {/* Amenities (0009). Same inline-select treatment as Pets: the
                detail page is where an unanswered question gets answered. */}
            <DetailField label="Laundry">
              <SimpleSelect<LaundryPolicy>
                size="sm"
                className="w-40"
                aria-label="Laundry"
                value={listing.laundry ?? "unknown"}
                options={LAUNDRY_OPTIONS}
                onValueChange={(laundry) => save({ laundry })}
              />
            </DetailField>
            <DetailField label="Dishwasher">
              <SimpleSelect<DishwasherPolicy>
                size="sm"
                className="w-40"
                aria-label="Dishwasher"
                value={listing.dishwasher ?? "unknown"}
                options={DISHWASHER_OPTIONS}
                onValueChange={(dishwasher) => save({ dishwasher })}
              />
            </DetailField>
            <DetailField label="AC">
              <SimpleSelect<AcPolicy>
                size="sm"
                className="w-40"
                aria-label="AC"
                value={listing.ac ?? "unknown"}
                options={AC_OPTIONS}
                onValueChange={(ac) => save({ ac })}
              />
            </DetailField>
            <DetailField label="Outdoor">
              <SimpleSelect<OutdoorSpacePolicy>
                size="sm"
                className="w-40"
                aria-label="Outdoor space"
                value={listing.outdoor_space ?? "unknown"}
                options={OUTDOOR_OPTIONS}
                onValueChange={(outdoor_space) => save({ outdoor_space })}
              />
            </DetailField>
            <DetailField label="Income x">
              <InlineEdit
                label="income multiplier"
                type="number"
                value={listing.income_multiplier}
                onSave={(raw) => save({ income_multiplier: toNumberOrNull(raw) })}
              />
            </DetailField>
            <DetailField label="Trains">
              <InlineEdit
                label="trains"
                value={listing.trains}
                onSave={(raw) => save({ trains: toTextOrNull(raw) })}
              />
            </DetailField>
            <DetailField label="Link">
              <InlineEdit
                label="link"
                value={listing.url}
                className="truncate"
                // Same rule as the add form (`URL_RE`): the inline edit is a
                // second door into the same column and had no lock on it.
                onSave={(raw) => {
                  const url = toTextOrNull(raw);
                  if (url !== null && !URL_RE.test(url)) {
                    toast.error("Links must start with http:// or https://");
                    return;
                  }
                  save({ url });
                }}
              />
            </DetailField>
            {/* Only when there is something to check. `state_checked_at` and
                the chip beside it are written by /api/sync and by this row's
                own "Check now"; nothing else in the form touches them. */}
            {listing.url && (
              <DetailField label="Link status">
                <LinkStatus listing={listing} />
              </DetailField>
            )}
            <DetailField label="Added by">
              <PersonDot person={listing.added_by_person} withName />
            </DetailField>
            <DetailField label="Updated">
              {listing.updated_at ? fmtNY(listing.updated_at) : "—"}
            </DetailField>
          </dl>

          <div className="mt-3 border-t border-border pt-3">
            <p className="mb-1 text-sm text-muted-foreground">Notes</p>
            <InlineEdit
              label="notes"
              multiline
              value={listing.notes}
              placeholder="Add notes…"
              className="whitespace-pre-wrap"
              onSave={(raw) => save({ notes: toTextOrNull(raw) })}
            />
          </div>
        </CardContent>
      </Card>

      {/* Where it is and how long it takes to get anywhere — above the broker,
          because it is the question people ask before they call. */}
      <CommuteCard listing={listing} />

      <BrokerCard listing={listing} />

      <NextActionCard listing={listing} />

      <InteractionsCard listing={listing} />

      {/* `#thread` is a real destination: the activity feed's "messaged
          about ..." lines, the home strip and anything anyone pastes into the
          chat all point here. `scroll-mt` keeps the heading clear of the
          sticky top bar. */}
      <Card id="thread" ref={threadRef} className="scroll-mt-20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Thread
            {/* Clears within a second of arriving — `Thread` marks itself read
                on mount — but arriving from a link should still say what you
                came for. */}
            <UnreadBadge count={unread.byListing[listing.id] ?? 0} />
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Bounded: the page keeps scrolling, the thread scrolls inside. */}
          <Thread listingId={listing.id} className="h-[50vh] min-h-64" />
        </CardContent>
      </Card>
    </div>
  );
}

function DetailField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] items-center gap-2 border-b border-border py-1.5 last:border-0 md:border-b">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}
