"use client";

import { Mail, Phone } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SimpleSelect, type SelectOption } from "@/components/simple-select";
import { useRowEdit } from "@/components/listings/use-row-edit";
import { useBrokers, type ListingRow } from "@/lib/queries";

export function BrokerCard({ listing }: { listing: ListingRow }) {
  const { data: brokers = [] } = useBrokers();
  const save = useRowEdit(listing);
  const broker = listing.broker;

  const options: SelectOption[] = [
    { value: "none", label: "No broker" },
    ...brokers.map((b) => ({
      value: b.id,
      label: b.company ? `${b.name} — ${b.company}` : b.name,
    })),
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Broker</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        {broker ? (
          <>
            <div>
              <p className="font-medium">{broker.name}</p>
              {broker.company && (
                <p className="text-muted-foreground">{broker.company}</p>
              )}
            </div>
            <div className="flex flex-wrap gap-3">
              {broker.phone && (
                <a
                  href={`tel:${broker.phone.replace(/[^\d+]/g, "")}`}
                  className="flex items-center gap-1.5 underline-offset-4 hover:underline"
                >
                  <Phone className="size-3.5" />
                  {broker.phone}
                </a>
              )}
              {broker.email && (
                <a
                  href={`mailto:${broker.email}`}
                  className="flex items-center gap-1.5 underline-offset-4 hover:underline"
                >
                  <Mail className="size-3.5" />
                  {broker.email}
                </a>
              )}
            </div>
            {broker.notes && (
              <p className="whitespace-pre-wrap text-muted-foreground">{broker.notes}</p>
            )}
          </>
        ) : (
          <p className="text-muted-foreground">No broker on this listing yet.</p>
        )}

        <SimpleSelect
          className="mt-1 w-full sm:w-72"
          aria-label="Change broker"
          value={listing.broker_id ?? "none"}
          options={options}
          onValueChange={(value) =>
            save({ broker_id: value === "none" ? null : value })
          }
        />
      </CardContent>
    </Card>
  );
}
