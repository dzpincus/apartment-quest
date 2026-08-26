"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Home, Building2, MessageSquare, Contact, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { usePerson } from "@/lib/person";
import { useQueue } from "@/components/queue/use-queue";
import { needsAttentionCount } from "@/lib/queue";
import { useUnread } from "@/lib/queries";
import { UnreadBadge } from "@/components/unread-badge";

const TABS = [
  { href: "/", label: "Home", icon: Home },
  { href: "/listings", label: "Listings", icon: Building2 },
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/brokers", label: "Brokers", icon: Contact },
] as const;

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/** Overdue + today, the only number worth interrupting anyone with. */
function DueBadge({ count, className }: { count: number; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-urgent px-1 text-[10px] font-black tabular-nums text-ink",
        className,
      )}
      aria-label={`${count} needing follow-up`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

function LogoutButton({ className }: { className?: string }) {
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="sm"
      className={className}
      onClick={async () => {
        await createClient().auth.signOut();
        router.replace("/login");
        router.refresh();
      }}
    >
      <LogOut />
      <span className="sr-only md:not-sr-only">Log out</span>
    </Button>
  );
}

/** The person chip: dot in their colour, name, on a bordered pill. */
function PersonPill() {
  const { person } = usePerson();
  if (!person) return null;
  return (
    <span className="flex items-center gap-1.5 rounded-full border-2 border-border bg-card py-1 pr-3 pl-1.5 text-[13px] font-extrabold">
      <span
        className="size-4.5 rounded-full"
        style={{ backgroundColor: person.color ?? "#888" }}
        aria-hidden
      />
      {person.name}
    </span>
  );
}

export function Nav() {
  const pathname = usePathname();
  // Overdue + due today. Reads the shared listings cache, so this costs no
  // extra request beyond the one the home screen already makes.
  const { buckets } = useQueue();
  const due = needsAttentionCount(buckets);
  // Only the global thread: per-listing unreads live next to their listing.
  const unreadChat = useUnread().global;

  return (
    <>
      {/* Desktop: top bar */}
      <header className="sticky top-0 z-40 hidden border-b border-border bg-card/90 backdrop-blur md:block">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-1 px-4">
          <Link href="/" className="mr-4 text-lg font-black tracking-tight">
            Apartment Quest
          </Link>
          {TABS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-extrabold text-muted-foreground hover:bg-secondary hover:text-foreground",
                isActive(pathname, href) &&
                  "bg-primary text-ink hover:bg-primary hover:text-ink",
              )}
            >
              {label}
              {href === "/" && due > 0 && <DueBadge count={due} />}
              {href === "/chat" && <UnreadBadge count={unreadChat} />}
            </Link>
          ))}
          <div className="ml-auto flex items-center gap-2">
            <PersonPill />
            <LogoutButton />
          </div>
        </div>
      </header>

      {/* Mobile: the page owns its own big title (see the design), so this row
          carries only who you are and the way out. */}
      <header className="sticky top-0 z-40 flex h-12 items-center justify-end gap-1 px-4 md:hidden">
        <PersonPill />
        <LogoutButton />
      </header>

      {/* Mobile: floating pill tab bar. */}
      <nav className="fixed inset-x-0 bottom-0 z-40 mx-4 mb-[max(1.25rem,env(safe-area-inset-bottom))] grid grid-cols-4 rounded-full border-2 border-border bg-card p-2 shadow-[0_6px_0_rgba(0,0,0,0.25)] md:hidden">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-col items-center gap-0.5 rounded-full py-1.5 text-[10px] font-extrabold text-muted-foreground",
                active && "bg-primary text-ink",
              )}
            >
              <span className="relative">
                <Icon className="size-5" strokeWidth={2.5} />
                {href === "/" && due > 0 && (
                  <DueBadge count={due} className="absolute -top-1.5 -right-2.5" />
                )}
                {href === "/chat" && (
                  <UnreadBadge
                    count={unreadChat}
                    className="absolute -top-1.5 -right-2.5"
                  />
                )}
              </span>
              {label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
