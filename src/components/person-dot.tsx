import { cn } from "@/lib/utils";
import type { Person } from "@/lib/types";

export function PersonDot({
  person,
  withName = false,
  className,
}: {
  person: Pick<Person, "name" | "color"> | null | undefined;
  withName?: boolean;
  className?: string;
}) {
  if (!person) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span
        className="size-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: person.color ?? "#888" }}
        aria-hidden
      />
      <span className={withName ? undefined : "sr-only"}>{person.name}</span>
    </span>
  );
}
