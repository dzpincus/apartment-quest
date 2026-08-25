"use client";

import { Badge } from "@/components/ui/badge";
import { qualification } from "@/lib/dedupe";
import { moneyShort } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Combined annual income vs `rent * income_multiplier` (NYC 40x). See
 * `qualification()` for why it is not the spec's `rent * 12 * multiplier`.
 */
export function QualifyBadge({
  rent,
  incomeMultiplier,
  incomes,
  className,
}: {
  rent: number | null | undefined;
  incomeMultiplier: number | null | undefined;
  incomes: ReadonlyArray<number | null | undefined>;
  className?: string;
}) {
  if (rent == null) return <span className="text-muted-foreground">—</span>;
  const q = qualification(rent, incomeMultiplier, incomes);
  return (
    <span className={cn("flex items-center gap-1.5 whitespace-nowrap", className)}>
      <Badge variant={q.passes ? "default" : "destructive"}>
        {q.passes ? "PASS" : "FAIL"}
      </Badge>
      <span className="text-xs text-muted-foreground">
        {moneyShort(q.combined)} / {moneyShort(q.required)}
      </span>
    </span>
  );
}
