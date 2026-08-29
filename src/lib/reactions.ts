/**
 * Emoji reactions on chat messages (0014). Pure and dependency-free, so the
 * grouping and the optimistic cache patch are both testable in node — the two
 * places this feature can silently go wrong.
 *
 * A reaction is a read receipt with a face on it. It writes no `activity` row
 * (see `toggleReaction` in `mutations.ts`), it never changes a thread's
 * snippet, and the only thing it means is "seen, and here is how I feel".
 */

/**
 * The palette. Six, not a picker: a grid somebody has to read is slower than
 * typing "ok", and the whole point is to be faster than typing "ok".
 *
 * Not a CHECK constraint and not an enum — the column (0014) is text with a
 * length limit, so a seventh is a one-line change here and no migration. Older
 * rows carrying an emoji that is no longer in this list still group and still
 * render; they just sort after the six.
 */
export const REACTION_EMOJI = ["👍", "❤️", "😂", "🔥", "👀", "😬"] as const;

export type ReactionEmoji = (typeof REACTION_EMOJI)[number];

/** The two columns grouping reads. `ReactionRow` from `queries.ts` satisfies it. */
export type ReactionLike = {
  person_id: string;
  emoji: string;
};

/** One chip under a bubble: the face, how many, and whether you are one of them. */
export type ReactionGroup = {
  emoji: string;
  count: number;
  /** True when `myPersonId` is in `personIds` — the chip's filled state. */
  mine: boolean;
  /** In arrival order, so the tooltip lists people the way they reacted. */
  personIds: string[];
};

const PALETTE_ORDER = new Map<string, number>(
  REACTION_EMOJI.map((emoji, index) => [emoji as string, index]),
);

/**
 * Reactions on one message, collapsed into one chip per emoji.
 *
 * Ordered by the palette first (so the row of chips under a bubble is stable
 * and always reads left-to-right the same way as the picker), then anything
 * else by first appearance — an emoji that used to be in the palette, or one
 * written by hand against the API, still gets a chip rather than disappearing.
 *
 * A person can hold at most one row per emoji (the primary key says so), but
 * this tolerates a duplicate rather than trusting it: `personIds` is deduped,
 * so `count` is people and never rows.
 */
export function groupReactions(
  reactions: readonly ReactionLike[] | null | undefined,
  myPersonId: string | null | undefined,
): ReactionGroup[] {
  if (!reactions || reactions.length === 0) return [];

  const byEmoji = new Map<string, ReactionGroup>();
  const seen = new Map<string, Set<string>>();

  for (const reaction of reactions) {
    if (!reaction || typeof reaction.emoji !== "string" || reaction.emoji === "") continue;
    const people = seen.get(reaction.emoji) ?? new Set<string>();
    if (people.has(reaction.person_id)) continue;
    people.add(reaction.person_id);
    seen.set(reaction.emoji, people);

    const group =
      byEmoji.get(reaction.emoji) ??
      { emoji: reaction.emoji, count: 0, mine: false, personIds: [] };
    group.count += 1;
    group.personIds.push(reaction.person_id);
    if (myPersonId && reaction.person_id === myPersonId) group.mine = true;
    byEmoji.set(reaction.emoji, group);
  }

  // `Map` iterates in insertion order, which *is* first appearance — so the
  // index below is the tie-break for everything outside the palette.
  const groups = [...byEmoji.values()];
  const appearance = new Map(groups.map((group, index) => [group.emoji, index]));
  const rank = (emoji: string) =>
    PALETTE_ORDER.has(emoji)
      ? PALETTE_ORDER.get(emoji)!
      : REACTION_EMOJI.length + appearance.get(emoji)!;

  return groups.sort((a, b) => rank(a.emoji) - rank(b.emoji));
}

/** The shape the optimistic patch needs: an id and an array of reactions. */
export type ReactableMessage = {
  id: string;
  reactions?: ReactionLike[] | null;
};

/**
 * The thread as it will look once the write lands: one reaction added, or the
 * same one taken away.
 *
 * Toggle rather than set, because the button is a toggle and the server write
 * is the matching insert-or-delete — the two have to agree on what a second tap
 * means or the optimistic state flickers back on `onSettled`.
 *
 * Returns the array it was given when nothing matched (an id from another
 * thread, a message that has since been deleted), so a stray patch cannot make
 * React Query re-render every open thread.
 */
export function toggleReactionPatch<M extends ReactableMessage>(
  messages: readonly M[] | null | undefined,
  messageId: string,
  personId: string,
  emoji: string,
): M[] {
  const rows = messages ?? [];
  let hit = false;

  const next = rows.map((message) => {
    if (message.id !== messageId) return message;
    hit = true;
    const reactions = message.reactions ?? [];
    const mine = reactions.some(
      (r) => r.person_id === personId && r.emoji === emoji,
    );
    return {
      ...message,
      reactions: mine
        ? reactions.filter((r) => !(r.person_id === personId && r.emoji === emoji))
        : [...reactions, { person_id: personId, emoji }],
    };
  });

  return hit ? next : (rows as M[]);
}

/** Does this person already hold this reaction? Decides insert vs delete. */
export function hasReaction(
  reactions: readonly ReactionLike[] | null | undefined,
  personId: string,
  emoji: string,
): boolean {
  return (reactions ?? []).some((r) => r.person_id === personId && r.emoji === emoji);
}
