"use client";

import { useMemo } from "react";
import { Mail, Phone } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AddBrokerDialog, EditBrokerDialog } from "@/components/brokers/broker-dialog";
import { useBrokers, useListings } from "@/lib/queries";
import type { Broker, Uuid } from "@/lib/types";

export default function BrokersPage() {
  const { data: brokers = [], isPending } = useBrokers();
  const { data: listings = [] } = useListings();

  const counts = useMemo(() => {
    const map = new Map<Uuid, number>();
    for (const l of listings) {
      if (l.broker_id) map.set(l.broker_id, (map.get(l.broker_id) ?? 0) + 1);
    }
    return map;
  }, [listings]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="text-[26px] leading-tight md:text-2xl">Brokers</h1>
        <span className="text-sm text-muted-foreground tabular-nums">{brokers.length}</span>
        <div className="ml-auto">
          <AddBrokerDialog />
        </div>
      </div>

      {isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : brokers.length === 0 ? (
        <p className="rounded-2xl border-2 border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No brokers yet. Add one, or create one while adding a listing.
        </p>
      ) : (
        <>
          <div className="hidden md:block">
            <Table className="text-sm">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="text-right">Listings</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {brokers.map((broker) => (
                  <TableRow key={broker.id}>
                    <TableCell className="font-medium">{broker.name}</TableCell>
                    <TableCell>{broker.company ?? "—"}</TableCell>
                    <TableCell>
                      <PhoneLink phone={broker.phone} />
                    </TableCell>
                    <TableCell>
                      <EmailLink email={broker.email} />
                    </TableCell>
                    <TableCell className="max-w-64 truncate text-muted-foreground">
                      {broker.notes ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {counts.get(broker.id) ?? 0}
                    </TableCell>
                    <TableCell className="text-right">
                      <EditBrokerDialog broker={broker} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="grid gap-2 md:hidden">
            {brokers.map((broker) => (
              <BrokerCardRow
                key={broker.id}
                broker={broker}
                count={counts.get(broker.id) ?? 0}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function BrokerCardRow({ broker, count }: { broker: Broker; count: number }) {
  return (
    <Card className="gap-1.5 p-3.5 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-black">{broker.name}</p>
          {broker.company && (
            <p className="truncate text-xs text-muted-foreground">{broker.company}</p>
          )}
        </div>
        <EditBrokerDialog broker={broker} />
      </div>
      <div className="flex flex-wrap gap-3">
        <PhoneLink phone={broker.phone} />
        <EmailLink email={broker.email} />
      </div>
      {broker.notes && (
        <p className="whitespace-pre-wrap text-muted-foreground">{broker.notes}</p>
      )}
      <p className="text-xs text-muted-foreground">
        {count} {count === 1 ? "listing" : "listings"}
      </p>
    </Card>
  );
}

function PhoneLink({ phone }: { phone: string | null }) {
  if (!phone) return <span className="text-muted-foreground">—</span>;
  return (
    <a
      href={`tel:${phone.replace(/[^\d+]/g, "")}`}
      className="flex items-center gap-1.5 underline-offset-4 hover:underline"
    >
      <Phone className="size-3.5" />
      {phone}
    </a>
  );
}

function EmailLink({ email }: { email: string | null }) {
  if (!email) return <span className="text-muted-foreground">—</span>;
  return (
    <a
      href={`mailto:${email}`}
      className="flex items-center gap-1.5 truncate underline-offset-4 hover:underline"
    >
      <Mail className="size-3.5" />
      {email}
    </a>
  );
}
