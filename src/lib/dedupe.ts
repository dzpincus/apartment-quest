/**
 * Dedupe key + roommate qualification math. Pure functions, unit-tested in
 * `dedupe.test.ts`. No React, no Supabase — importable from anywhere.
 */

/**
 * Mirror of the Postgres generated column on `listings`:
 *
 *   lower(regexp_replace(coalesce(address,'') || '|' || coalesce(unit,''), '[^a-zA-Z0-9|]', '', 'g'))
 *
 * Computed client-side so the add form can check for duplicates *before*
 * inserting. Must stay byte-identical to 0001_schema.sql.
 */
export function dedupeKey(
  address: string | null | undefined,
  unit?: string | null | undefined,
): string {
  const raw = `${address ?? ""}|${unit ?? ""}`;
  return raw.replace(/[^a-zA-Z0-9|]/g, "").toLowerCase();
}

export type Qualification = {
  /** Combined annual income the landlord will ask for. */
  required: number;
  /** Sum of everyone's stated annual income. */
  combined: number;
  passes: boolean;
  /** combined / required. 1 when there is nothing to qualify against. */
  ratio: number;
};

/**
 * NYC "40x" means combined **annual** income >= 40 x **monthly** rent, so:
 *
 *   required = rent * income_multiplier
 *
 * NOTE: SPEC.md writes this as `rent * 12 * income_multiplier`, which is the
 * same 40x rule applied twice (it would demand $1.5M/yr on a $3,200 apartment).
 * The spec's own comment says "NYC standard is 40x monthly rent", so the
 * convention wins over the formula. Deliberate deviation.
 */
export function qualification(
  rent: number | null | undefined,
  incomeMultiplier: number | null | undefined,
  annualIncomes: ReadonlyArray<number | null | undefined>,
): Qualification {
  const multiplier = incomeMultiplier ?? 40;
  const required = Math.max(0, Math.round((rent ?? 0) * multiplier));
  const combined = annualIncomes.reduce<number>((sum, n) => sum + (n ?? 0), 0);
  return {
    required,
    combined,
    passes: combined >= required,
    ratio: required > 0 ? combined / required : 1,
  };
}
