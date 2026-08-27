/**
 * "Powered by Google" — a licence term, not decoration.
 *
 * Google's Routes API terms allow its results to be displayed *away from a
 * Google map* only when this credit appears with them. So it belongs anywhere
 * a `commute_times` number reaches a screen: the detail card's table, the
 * listings table's "Transit to ⭐" column and the mobile cards' ⭐ chip. Three
 * copies of the same sentence is three chances for one to be deleted as
 * clutter, so it is one component and the comment explaining why lives here.
 *
 * `text-faint` is the decoration tint (see CLAUDE.md's contrast rule) — this
 * line is required, but it is required to be *present*, not to be read.
 */

import { cn } from "@/lib/utils";

export function PoweredByGoogle({ className }: { className?: string }) {
  return <p className={cn("text-[11px] text-faint", className)}>Powered by Google</p>;
}
