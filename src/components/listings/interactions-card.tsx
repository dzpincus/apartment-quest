"use client";

/** Contact history for one listing, newest first, plus the way to add to it. */

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PersonDot } from "@/components/person-dot";
import { LogContactDialog } from "@/components/queue/log-contact-dialog";
import { useInteractions } from "@/lib/queries";
import { INTERACTION_KIND_LABELS } from "@/lib/format";
import { fmtNY } from "@/lib/time";
import type { ListingRow } from "@/lib/queries";

export function InteractionsCard({ listing }: { listing: ListingRow }) {
  const { data: interactions, isPending, error } = useInteractions(listing.id);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Interactions</CardTitle>
          <LogContactDialog listing={listing} />
        </div>
      </CardHeader>
      <CardContent className="grid gap-2">
        {isPending && <Skeleton className="h-16 w-full" />}
        {error && (
          <p className="text-sm text-destructive">
            Could not load interactions: {String((error as Error).message)}
          </p>
        )}
        {!isPending && !error && interactions?.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nobody has contacted anyone about this yet.
          </p>
        )}

        {interactions?.map((row) => (
          <div key={row.id} className="grid gap-1 border-b pb-2 last:border-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">
                {INTERACTION_KIND_LABELS[row.kind ?? "note"]}
              </Badge>
              <PersonDot person={row.person} withName />
              <span className="tabular-nums">
                {row.occurred_at ? fmtNY(row.occurred_at, "MMM d, h:mm a") : ""}
              </span>
            </div>
            {row.notes && <p className="whitespace-pre-wrap text-sm">{row.notes}</p>}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
