/**
 * Message grouping for the thread view. Pure and dependency-free so it can be
 * tested in node (`chat.test.ts`) — the same "consecutive runs of one person"
 * idea as the activity feed, plus a time gap: two messages from the same
 * person an hour apart are two thoughts, not one paragraph.
 */

/** The shape `groupMessages` needs. `MessageRow` from `queries.ts` satisfies it. */
export type GroupableMessage = {
  id: string;
  person_id: string;
  created_at: string | null;
};

export type MessageGroup<T extends GroupableMessage> = {
  /** The first message's id — stable React key. */
  key: string;
  personId: string;
  /** `created_at` of the first message in the run. */
  startedAt: string | null;
  items: T[];
};

/** A quiet stretch this long starts a new group even for the same person. */
export const GROUP_GAP_MS = 10 * 60_000;

function ms(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * Splits an ascending list of messages into consecutive same-person runs.
 * A run also breaks when more than `gapMs` passed since the previous message.
 * Unparseable / missing timestamps never break a run — the person does.
 */
export function groupMessages<T extends GroupableMessage>(
  rows: readonly T[],
  gapMs: number = GROUP_GAP_MS,
): MessageGroup<T>[] {
  const groups: MessageGroup<T>[] = [];
  let prevAt: number | null = null;

  for (const row of rows) {
    const at = ms(row.created_at);
    const last = groups[groups.length - 1];
    const samePerson = last?.personId === row.person_id;
    const withinGap = at === null || prevAt === null || at - prevAt <= gapMs;

    if (last && samePerson && withinGap) {
      last.items.push(row);
    } else {
      groups.push({
        key: row.id,
        personId: row.person_id,
        startedAt: row.created_at,
        items: [row],
      });
    }
    if (at !== null) prevAt = at;
  }

  return groups;
}
