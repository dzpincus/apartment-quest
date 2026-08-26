"use client";

import { Thread } from "@/components/chat/thread";
import { usePerson } from "@/lib/person";

/**
 * The global thread. Height is pinned to the viewport minus the chrome
 * (`100dvh` so mobile browser bars do not hide the composer) so the message
 * list scrolls instead of the page — a chat that pushes the composer off the
 * bottom of a long page is unusable on a phone.
 */
export default function ChatPage() {
  const { people } = usePerson();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-[26px] leading-tight md:text-2xl">Group chat</h1>
          <p className="text-sm text-muted-foreground">
            Everything that is not about one listing.
          </p>
        </div>
        {/* Overlapping dots, one per person, in their own colour. */}
        <div className="flex shrink-0 items-center">
          {people.map((p) => (
            <span
              key={p.id}
              title={p.name}
              className="size-5.5 rounded-full border-2 border-background not-first:-ml-1.5"
              style={{ backgroundColor: p.color ?? "#888" }}
            />
          ))}
        </div>
      </div>
      <Thread
        listingId={null}
        className="h-[calc(100dvh-16rem)] min-h-72 md:h-[calc(100dvh-12rem)]"
      />
    </div>
  );
}
