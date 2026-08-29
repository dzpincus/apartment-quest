"use client";

/**
 * The faces under a chat bubble (0014).
 *
 * Four people in one thread do not need a "got it" message; they need a way to
 * say it without one. So: a row of chips, one per emoji, and a quiet button
 * that opens the six-emoji palette.
 *
 * The write is optimistic (`toggleReaction` in `mutations.ts`) — a chip that
 * waits for a round trip before it fills in feels broken, and this is a chat,
 * where everything else on screen is instant. It writes no activity row: a
 * reaction is a read receipt with a face on it, not an impression.
 *
 * Your own bubbles are reactable too. There is no per-person boundary anywhere
 * in this app, and "🔥 on my own idea" is a thing people do.
 */

import { useMemo, useState } from "react";
import { SmilePlus } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { usePerson } from "@/lib/person";
import { useMutations } from "@/lib/mutations";
import { ownersOf } from "@/lib/people";
import { groupReactions, hasReaction, REACTION_EMOJI } from "@/lib/reactions";
import { cn } from "@/lib/utils";
import type { MessageRow } from "@/lib/queries";

export function MessageReactions({
  message,
  /** Which edge the row hangs from — your bubbles sit on the right. */
  align = "start",
  className,
}: {
  message: MessageRow;
  align?: "start" | "end";
  className?: string;
}) {
  const { person, people } = usePerson();
  const { toggleReaction } = useMutations(person?.id);
  const [open, setOpen] = useState(false);

  const groups = useMemo(
    () => groupReactions(message.reactions, person?.id),
    [message.reactions, person?.id],
  );

  function toggle(emoji: string) {
    if (!person) return;
    toggleReaction.mutate({
      message: { id: message.id, listing_id: message.listing_id },
      emoji,
      // Read from the row rather than from the group, so the picker and the
      // chips make the same decision about the same tap.
      currently: hasReaction(message.reactions, person.id, emoji),
    });
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1",
        align === "end" ? "justify-end pr-1" : "pl-1",
        className,
      )}
    >
      {groups.map((group) => (
        <button
          key={group.emoji}
          type="button"
          aria-pressed={group.mine}
          aria-label={`${group.emoji} ${group.count}`}
          disabled={!person}
          onClick={() => toggle(group.emoji)}
          title={
            ownersOf(group.personIds, people)
              .map((p) => p.name)
              .join(", ") || undefined
          }
          className={cn(
            "inline-flex h-6 cursor-pointer items-center gap-1 rounded-full border px-1.5 text-[11px] font-extrabold tabular-nums transition-colors",
            group.mine
              ? "border-primary bg-primary/15"
              : "border-border bg-card hover:bg-surface-hover",
          )}
        >
          <span aria-hidden>{group.emoji}</span>
          {group.count}
        </button>
      ))}

      {/* Always there on touch, where there is no hover to reveal it — just
          faint. On a pointer device it appears with the bubble, and stays put
          while its own popover is open. */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          aria-label="Add a reaction"
          disabled={!person}
          className={cn(
            "inline-flex size-6 cursor-pointer items-center justify-center rounded-full text-muted-foreground opacity-60 transition-opacity hover:bg-surface-hover hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:opacity-0 md:group-hover/message:opacity-100",
            open && "opacity-100 md:opacity-100",
          )}
        >
          <SmilePlus className="size-3.5" />
        </PopoverTrigger>
        <PopoverContent
          align={align}
          className="w-auto flex-row gap-0.5 p-1"
          aria-label="Pick a reaction"
        >
          {REACTION_EMOJI.map((emoji) => (
            <button
              key={emoji}
              type="button"
              aria-label={emoji}
              aria-pressed={person ? hasReaction(message.reactions, person.id, emoji) : false}
              onClick={() => {
                toggle(emoji);
                setOpen(false);
              }}
              className={cn(
                "inline-flex size-10 cursor-pointer items-center justify-center rounded-full text-lg transition-colors hover:bg-surface-hover",
                person &&
                  hasReaction(message.reactions, person.id, emoji) &&
                  "bg-primary/15",
              )}
            >
              {emoji}
            </button>
          ))}
        </PopoverContent>
      </Popover>
    </div>
  );
}
