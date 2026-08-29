"use client";

/**
 * The forced follow-up prompt (SPEC: "Logging inserts an interaction, bumps
 * last_contacted_at, and immediately prompts for the next action and due
 * date"). Used twice: as step 2 of the log-contact dialog, where it is the
 * only way out, and standalone on the listing detail page, where it is not.
 */

import { useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PersonDot } from "@/components/person-dot";
import { usePerson } from "@/lib/person";
import { useMutations } from "@/lib/mutations";
import { ownersOf } from "@/lib/people";
import { tomorrowNY } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { Listing, Uuid } from "@/lib/types";

export type NextActionTarget = Pick<Listing, "id" | "address" | "unit">;

/** Common answers, so the fast path is one tap instead of a sentence. */
const SUGGESTIONS = [
  "Call back",
  "Text for availability",
  "Email for application",
  "Confirm tour time",
] as const;

export function NextActionForm({
  listing,
  initial,
  submitLabel = "Save next action",
  autoFocus = true,
  onSaved,
  children,
}: {
  listing: NextActionTarget;
  /**
   * Prefill for "edit the existing plan"; omitted for "decide a new one".
   * `ownerIds` present-but-empty is a plan somebody deliberately left
   * unassigned, and stays that way — only an *absent* `initial` defaults to the
   * person holding the phone.
   */
  initial?: {
    nextAction?: string | null;
    dueDate?: string | null;
    ownerIds?: readonly Uuid[] | null;
  };
  submitLabel?: string;
  autoFocus?: boolean;
  onSaved?: () => void;
  /** Secondary actions rendered to the left of the submit button. */
  children?: React.ReactNode;
}) {
  const { person, people } = usePerson();
  const { setNextAction } = useMutations(person?.id);

  const [text, setText] = useState(initial?.nextAction ?? "");
  const [due, setDue] = useState(initial?.dueDate ?? tomorrowNY());
  // "Whoever is filling this in" is the right default and always was; what
  // changed in 0014 is that it is a starting point rather than the only answer.
  const [ownerIds, setOwnerIds] = useState<Uuid[]>(() =>
    initial?.ownerIds ? [...initial.ownerIds] : person ? [person.id] : [],
  );

  const toggleOwner = (id: Uuid) =>
    setOwnerIds((current) =>
      current.includes(id) ? current.filter((o) => o !== id) : [...current, id],
    );

  const canSave = text.trim().length > 0 && Boolean(due) && !setNextAction.isPending;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSave) return;
    try {
      await setNextAction.mutateAsync({
        listing,
        nextAction: text,
        dueDate: due,
        ownerIds,
        // Names rather than ids, because the feed line is rendered at insert
        // time and is a snapshot of what was decided.
        owners: ownersOf(ownerIds, people).map((p) => p.name),
      });
    } catch {
      // Toasted by `onError`. `onSaved` closes the un-skippable prompt, so it
      // must not fire for a plan that was never written.
      return;
    }
    onSaved?.();
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      <Field>
        <FieldLabel htmlFor="next-action">Next action</FieldLabel>
        <Input
          id="next-action"
          autoFocus={autoFocus}
          required
          placeholder="Call back about the 1st"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex flex-wrap gap-1">
          {SUGGESTIONS.map((s) => (
            <Button
              key={s}
              type="button"
              size="xs"
              variant="outline"
              onClick={() => setText(s)}
            >
              {s}
            </Button>
          ))}
        </div>
      </Field>

      <Field>
        <FieldLabel htmlFor="next-action-due">Due</FieldLabel>
        <Input
          id="next-action-due"
          type="date"
          required
          value={due}
          onChange={(e) => setDue(e.target.value)}
          className="sm:max-w-52"
        />
      </Field>

      {/* Chips rather than a multi-select: four people is a row, and "both of
          us are going" should be one extra tap and not a keyboard modifier.
          Zero is allowed — an unassigned action is still an action somebody
          wrote down — and says so instead of looking broken. */}
      <Field>
        <FieldLabel>Who&rsquo;s on it</FieldLabel>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Who's on it">
          {people.map((p) => {
            const on = ownerIds.includes(p.id);
            const color = p.color ?? "#888";
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggleOwner(p.id)}
                className={cn(
                  "inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border-2 px-3 text-xs font-extrabold transition-colors",
                  on ? "text-ink" : "bg-transparent",
                )}
                style={
                  on
                    ? { backgroundColor: color, borderColor: color }
                    : { borderColor: color, color }
                }
              >
                {on ? (
                  <Check className="size-3.5" aria-hidden />
                ) : (
                  <PersonDot
                    person={p}
                    letter={p.name.slice(0, 1).toUpperCase()}
                    size="sm"
                    className="border-0"
                  />
                )}
                {p.name}
              </button>
            );
          })}
        </div>
        {ownerIds.length === 0 && (
          <p className="text-xs text-faint">Nobody yet — this one is the house&rsquo;s.</p>
        )}
      </Field>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {children}
        <Button type="submit" disabled={!canSave}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
