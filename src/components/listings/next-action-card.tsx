"use client";

/**
 * The listing's standing follow-up plan. Editing here is the one place the
 * next-action form is dismissable — the forced version lives in the log-contact
 * dialog, where skipping it would rot the queue.
 */

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PersonDot } from "@/components/person-dot";
import { NextActionForm } from "@/components/queue/next-action-form";
import { usePerson } from "@/lib/person";
import { useMutations } from "@/lib/mutations";
import { dueHint } from "@/lib/queue";
import { fmtDay, fmtNY, todayNY } from "@/lib/time";
import type { ListingRow } from "@/lib/queries";

export function NextActionCard({ listing }: { listing: ListingRow }) {
  const { person } = usePerson();
  const { clearNextAction } = useMutations(person?.id);
  const [editing, setEditing] = useState(false);
  const today = todayNY();

  // Same three colours the queue buckets use: coral late, yellow now, and
  // nothing at all when the plan is comfortably in the future.
  const due = listing.next_action_due;
  const tone = !due
    ? null
    : due < today
      ? "var(--urgent)"
      : due === today
        ? "var(--due)"
        : null;

  return (
    <Card
      className={tone ? "border-2" : undefined}
      style={tone ? { borderColor: tone } : undefined}
    >
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Next action</CardTitle>
          {!editing && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                {listing.next_action ? "Edit" : "Set"}
              </Button>
              {listing.next_action && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={clearNextAction.isPending}
                  onClick={() => clearNextAction.mutate(listing)}
                >
                  Clear
                </Button>
              )}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        {editing ? (
          <NextActionForm
            listing={listing}
            initial={{
              nextAction: listing.next_action,
              dueDate: listing.next_action_due,
              ownerId: listing.next_action_owner,
            }}
            onSaved={() => setEditing(false)}
          >
            <Button type="button" variant="outline" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </NextActionForm>
        ) : (
          <>
            <p className={listing.next_action ? "font-medium" : "text-muted-foreground"}>
              {listing.next_action || "No next action. This listing is drifting."}
            </p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
              {listing.next_action_due && (
                <span>
                  Due {fmtDay(listing.next_action_due, "MMM d, yyyy")} ·{" "}
                  <span
                    className="font-extrabold"
                    style={tone ? { color: tone } : undefined}
                  >
                    {dueHint(listing.next_action_due, today)}
                  </span>
                </span>
              )}
              {listing.next_action_owner_person && (
                <PersonDot person={listing.next_action_owner_person} withName />
              )}
              <span>
                Last contacted{" "}
                {listing.last_contacted_at
                  ? fmtNY(listing.last_contacted_at, "MMM d, h:mm a")
                  : "never"}
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
