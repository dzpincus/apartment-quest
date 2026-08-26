"use client";

import { qualification } from "@/lib/dedupe";
import { moneyShort } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Combined annual income vs `rent * income_multiplier` (NYC 40x). See
 * `qualification()` for why it is not the spec's `rent * 12 * multiplier`.
 *
 * Two numbers, no verdict: `$310k / $288k` is what people actually read, and
 * a PASS/FAIL badge beside it was both louder than the numbers and a harsher
 * word than the situation deserves — a listing 2% over the line is not a
 * failure, it is a conversation about a guarantor. The tint still says which
 * side of the line it lands on (mint over, coral under), the same two colours
 * the votes use, so nothing is lost but the shouting.
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
    <span
      title={`${moneyShort(q.combined)} combined income vs ${moneyShort(q.required)} required`}
      className={cn(
        "whitespace-nowrap text-xs font-extrabold tabular-nums",
        q.passes ? "text-yes" : "text-no",
        className,
      )}
    >
      {moneyShort(q.combined)} / {moneyShort(q.required)}
    </span>
  );
}
