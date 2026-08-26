"use client";

/**
 * Reverse-chronological feed, last ~50, grouped by consecutive runs of the same
 * person in their colour (SPEC). Summaries are pre-rendered at write time, so
 * this is one cheap query and no joins beyond the person.
 */

import { useMemo } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PersonDot } from "@/components/person-dot";
import { useActivity, type ActivityRow } from "@/lib/queries";
import { fmtNY } from "@/lib/time";

type Group = { key: string; person: ActivityRow["person"]; items: ActivityRow[] };

/** Consecutive runs only — the same person later in the feed starts a new group. */
export function groupByRun(rows: readonly ActivityRow[]): Group[] {
  const groups: Group[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last.items[0]?.person_id === row.person_id) {
      last.items.push(row);
    } else {
      groups.push({ key: row.id, person: row.person, items: [row] });
    }
  }
  return groups;
}

export function ActivityFeed({ limit = 50 }: { limit?: number }) {
  const { data, isPending, error } = useActivity(limit);
  const groups = useMemo(() => groupByRun(data ?? []), [data]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lately</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {isPending && <Skeleton className="h-24 w-full" />}
        {error && (
          <p className="text-sm text-destructive">
            Could not load activity: {String((error as Error).message)}
          </p>
        )}
        {!isPending && !error && groups.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nothing yet. Add a listing or log a contact.
          </p>
        )}

        {groups.map((group) => (
          <div
            key={group.key}
            className="border-l-2 pl-3"
            style={{ borderColor: group.person?.color ?? "#888" }}
          >
            <PersonDot
              person={group.person}
              withName
              colorName
              className="text-sm font-extrabold"
            />
            <ul className="mt-1 grid gap-1">
              {group.items.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm"
                >
                  <span className="min-w-0">
                    {item.entity_type === "listing" && item.entity_id ? (
                      <Link
                        href={`/listings/${item.entity_id}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {item.summary}
                      </Link>
                    ) : (
                      item.summary
                    )}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {item.created_at ? fmtNY(item.created_at, "MMM d, h:mm a") : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
