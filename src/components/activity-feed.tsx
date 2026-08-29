"use client";

/**
 * Reverse-chronological feed, grouped by consecutive runs of the same person in
 * their colour (SPEC). Summaries are pre-rendered at write time, so this is one
 * cheap query and no joins beyond the person.
 *
 * The body is a scroll panel capped at 60vh rather than a list that grows with
 * the house's history — Home is the queue first, and a feed that is 400 rows
 * tall pushes nothing but itself. The first fetch is the latest `PAGE` rows;
 * "Show older" raises the limit by another page (a bigger `limit` is a new
 * cache key, and `["activity"]` is a prefix of every one of them, so realtime
 * still invalidates whatever page is open). The button goes away when a fetch
 * comes back short: that is the whole timeline.
 */

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PersonDot } from "@/components/person-dot";
import { useActivity, type ActivityRow } from "@/lib/queries";
import { activityHref } from "@/lib/activity";
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

const PAGE = 50;

export function ActivityFeed() {
  const [limit, setLimit] = useState(PAGE);
  const { data, isPending, error, isFetching } = useActivity(limit);
  const groups = useMemo(() => groupByRun(data ?? []), [data]);
  const exhausted = data != null && data.length < limit;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lately</CardTitle>
      </CardHeader>
      <CardContent className="grid max-h-[60vh] content-start gap-4 overflow-y-auto overscroll-contain">
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
              {group.items.map((item) => {
                const href = activityHref(item);
                const when = item.created_at
                  ? fmtNY(item.created_at, "MMM d, h:mm a")
                  : "";
                const body = (
                  <>
                    <span className="min-w-0 underline-offset-4 group-hover:underline">
                      {item.summary}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {when}
                    </span>
                  </>
                );

                // The whole row is the target, not the four words in the middle
                // of it: on a phone the summary is one line of 13px text and
                // the timestamp is smaller still.
                const rowClass =
                  "group flex min-h-11 flex-wrap items-baseline justify-between gap-x-3 text-sm md:min-h-0";

                return (
                  <li key={item.id}>
                    {href ? (
                      <Link
                        href={href}
                        className={`${rowClass} -mx-1.5 rounded-lg px-1.5 hover:bg-surface-hover md:mx-0 md:px-0 md:hover:bg-transparent`}
                      >
                        {body}
                      </Link>
                    ) : (
                      <span className={rowClass}>{body}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        {!isPending && !error && groups.length > 0 && !exhausted && (
          <Button
            variant="outline"
            size="sm"
            className="justify-self-center"
            disabled={isFetching}
            onClick={() => setLimit((n) => n + PAGE)}
          >
            {isFetching ? "Loading…" : "Show older"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
