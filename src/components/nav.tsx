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
        "inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium tabular-nums text-white",
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

export function Nav() {
  const pathname = usePathname();
  const { person } = usePerson();
  // Overdue + due today. Reads the shared listings cache, so this costs no
  // extra request beyond the one the home screen already makes.
  const { buckets } = useQueue();
  const due = needsAttentionCount(buckets);
  // Only the global thread: per-listing unreads live next to their listing.
  const unreadChat = useUnread().global;

  return (
    <>
      {/* Desktop: top bar */}
      <header className="sticky top-0 z-40 hidden border-b bg-background/95 backdrop-blur md:block">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-1 px-4">
          <span className="mr-4 font-semibold">Apartment Quest</span>
          {TABS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground",
                isActive(pathname, href) && "bg-muted font-medium text-foreground",
              )}
            >
              {label}
              {href === "/" && due > 0 && <DueBadge count={due} />}
              {href === "/chat" && <UnreadBadge count={unreadChat} />}
            </Link>
          ))}
          <div className="ml-auto flex items-center gap-2">
            {person && (
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <span
                  className="size-2.5 rounded-full"
                  style={{ backgroundColor: person.color ?? "#888" }}
                />
                {person.name}
              </span>
            )}
            <LogoutButton />
          </div>
        </div>
      </header>

      {/* Mobile: title row + bottom tab bar */}
      <header className="sticky top-0 z-40 flex h-12 items-center justify-between border-b bg-background/95 px-4 backdrop-blur md:hidden">
        <span className="font-semibold">Apartment Quest</span>
        <div className="flex items-center gap-1">
          {person && (
            <span
              className="size-2.5 rounded-full"
              style={{ backgroundColor: person.color ?? "#888" }}
            />
          )}
          <LogoutButton />
        </div>
      </header>

      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t bg-background pb-[env(safe-area-inset-bottom)] md:hidden">
        {TABS.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex flex-col items-center gap-0.5 py-2 text-xs text-muted-foreground",
              isActive(pathname, href) && "text-foreground",
            )}
          >
            <span className="relative">
              <Icon className="size-5" />
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
        ))}
      </nav>
    </>
  );
}
