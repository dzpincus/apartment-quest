import { cn } from "@/lib/utils";

/**
 * The little count next to a thread. Deliberately not the red follow-up badge
 * in the nav — unread messages are interesting, an overdue broker is urgent.
 * Renders nothing at zero so callers can drop it in unconditionally.
 */
export function UnreadBadge({
  count,
  className,
}: {
  count: number;
  className?: string;
}) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        "inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-black tabular-nums text-primary-foreground",
        className,
      )}
      aria-label={`${count} unread message${count === 1 ? "" : "s"}`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
