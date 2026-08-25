"use client";

/**
 * The forced follow-up prompt (SPEC: "Logging inserts an interaction, bumps
 * last_contacted_at, and immediately prompts for the next action and due
 * date"). Used twice: as step 2 of the log-contact dialog, where it is the
 * only way out, and standalone on the listing detail page, where it is not.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SimpleSelect, type SelectOption } from "@/components/simple-select";
import { usePerson } from "@/lib/person";
import { useMutations } from "@/lib/mutations";
import { tomorrowNY } from "@/lib/time";
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
  /** Prefill for "edit the existing plan"; omitted for "decide a new one". */
  initial?: { nextAction?: string | null; dueDate?: string | null; ownerId?: Uuid | null };
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
  const [ownerId, setOwnerId] = useState<Uuid | null>(
    initial?.ownerId ?? person?.id ?? null,
  );

  const ownerOptions: SelectOption[] = people.map((p) => ({ value: p.id, label: p.name }));
  const canSave = text.trim().length > 0 && Boolean(due) && !setNextAction.isPending;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSave) return;
    await setNextAction.mutateAsync({
      listing,
      nextAction: text,
      dueDate: due,
      ownerId,
      ownerName: people.find((p) => p.id === ownerId)?.name ?? null,
    });
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

      <div className="grid gap-3 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="next-action-due">Due</FieldLabel>
          <Input
            id="next-action-due"
            type="date"
            required
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel>Owner</FieldLabel>
          <SimpleSelect
            aria-label="Owner"
            value={ownerId}
            options={ownerOptions}
            placeholder="Nobody yet"
            onValueChange={setOwnerId}
          />
        </Field>
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {children}
        <Button type="submit" disabled={!canSave}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
