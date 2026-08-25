"use client";

import { UserCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePerson } from "@/lib/person";
import { useMutations } from "@/lib/mutations";
import { money } from "@/lib/format";
import { toNumberOrNull } from "@/components/inline-edit";

/**
 * The app's entire "settings": your own display name, and everyone's stated
 * annual income (shared knowledge — anyone can fix anyone's number, since the
 * qualification math is useless if it is stale). Saves on blur.
 */
export function IncomesPopover() {
  const { person, people } = usePerson();
  const { updatePersonName, updatePersonIncome } = useMutations(person?.id);

  const combined = people.reduce((sum, p) => sum + (p.annual_income ?? 0), 0);

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm">
            <UserCog />
            You &amp; incomes
          </Button>
        }
      />
      <PopoverContent align="end" className="w-72">
        <PopoverHeader>
          <PopoverTitle>You &amp; incomes</PopoverTitle>
          <PopoverDescription>
            Annual income, before tax. Used for the 40x qualification check.
          </PopoverDescription>
        </PopoverHeader>

        {person && (
          <div className="grid gap-1.5">
            <Label htmlFor="own-name">Your name</Label>
            <Input
              id="own-name"
              key={`name-${person.id}-${person.name}`}
              defaultValue={person.name}
              onBlur={(e) => {
                const name = e.target.value.trim();
                if (name && name !== person.name) updatePersonName.mutate(name);
              }}
            />
          </div>
        )}

        <div className="grid gap-2">
          {people.map((p) => (
            <div key={p.id} className="grid grid-cols-[1fr_7rem] items-center gap-2">
              <Label
                htmlFor={`income-${p.id}`}
                className="gap-1.5 text-sm font-normal"
              >
                <span
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: p.color ?? "#888" }}
                  aria-hidden
                />
                {p.name}
              </Label>
              <Input
                id={`income-${p.id}`}
                key={`income-${p.id}-${p.annual_income ?? 0}`}
                type="number"
                inputMode="numeric"
                min={0}
                step={1000}
                defaultValue={p.annual_income ?? 0}
                onBlur={(e) => {
                  const next = toNumberOrNull(e.target.value) ?? 0;
                  if (next !== (p.annual_income ?? 0)) {
                    updatePersonIncome.mutate({ personId: p.id, income: next });
                  }
                }}
              />
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between border-t pt-2 text-sm">
          <span className="text-muted-foreground">Combined</span>
          <span className="font-medium">{money(combined)}</span>
        </div>
      </PopoverContent>
    </Popover>
  );
}
