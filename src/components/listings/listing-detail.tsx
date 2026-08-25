"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { InlineEdit, toNumberOrNull, toTextOrNull } from "@/components/inline-edit";
import { SimpleSelect } from "@/components/simple-select";
import { PersonDot } from "@/components/person-dot";
import { BrokerCard } from "@/components/listings/broker-card";
import { MergeIntoDialog } from "@/components/listings/merge-into-dialog";
import { QualifyBadge } from "@/components/listings/qualify-badge";
import { StatusSelect } from "@/components/listings/status-select";
import {
  FEE_OPTIONS,
  GUARANTOR_OPTIONS,
  choiceToGuarantor,
  guarantorToChoice,
  type GuarantorChoice,
} from "@/components/listings/options";
import { useRowEdit } from "@/components/listings/use-row-edit";
import { useListing } from "@/lib/queries";
import { usePerson } from "@/lib/person";
import { listingLabel, money } from "@/lib/format";
import { fmtDay, fmtNY } from "@/lib/time";
import type { FeeType, Uuid } from "@/lib/types";

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
      incomes={people.map((p) => p.annual_income)}
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

  return (
    <div className="space-y-4">
      {listing.merged_into && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
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

      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Link
            href="/listings"
            className="text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            ← Listings
          </Link>
          <h1 className="truncate text-xl font-semibold">
            {listingLabel(listing.address, listing.unit)}
          </h1>
          <p className="text-sm text-muted-foreground">
            {listing.neighborhood ?? "No neighborhood"} ·{" "}
            {listing.rent == null ? "no rent" : `${money(listing.rent)}/mo`} · added{" "}
            {listing.created_at ? fmtNY(listing.created_at, "MMM d") : "—"} by{" "}
            {listing.added_by_person?.name ?? "someone"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <QualifyBadge
            rent={listing.rent}
            incomeMultiplier={listing.income_multiplier}
            incomes={incomes}
          />
          <StatusSelect listing={listing} size="default" className="w-40" />
          {listing.url && (
            <Button variant="outline" size="sm" render={<a href={listing.url} target="_blank" rel="noreferrer" />}>
              <ExternalLink />
              Open
            </Button>
          )}
          <MergeIntoDialog listing={listing} />
        </div>
      </div>

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
                onSave={(raw) => save({ url: toTextOrNull(raw) })}
              />
            </DetailField>
            <DetailField label="Added by">
              <PersonDot person={listing.added_by_person} withName />
            </DetailField>
            <DetailField label="Updated">
              {listing.updated_at ? fmtNY(listing.updated_at) : "—"}
            </DetailField>
          </dl>

          <div className="mt-3 border-t pt-3">
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

      <BrokerCard listing={listing} />

      {/* Phase 3: interactions */}
      <PlaceholderCard
        title="Interaction history"
        note="Calls, emails, tours and the forced next-action prompt arrive in phase 3."
      />

      {/* Phase 4: thread */}
      <PlaceholderCard
        title="Thread"
        note="This listing's message thread arrives in phase 4."
      />

      {/* Phase 5: votes */}
      <PlaceholderCard
        title="Votes"
        note="Yes / maybe / no from all four people arrives in phase 5."
      />
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
    <div className="grid grid-cols-[7.5rem_1fr] items-center gap-2 border-b py-1.5 last:border-0 md:border-b">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}

function PlaceholderCard({ title, note }: { title: string; note: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">{note}</p>
      </CardContent>
    </Card>
  );
}
