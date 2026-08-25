import { Thread } from "@/components/chat/thread";

/**
 * The global thread. Height is pinned to the viewport minus the chrome
 * (`100dvh` so mobile browser bars do not hide the composer) so the message
 * list scrolls instead of the page — a chat that pushes the composer off the
 * bottom of a long page is unusable on a phone.
 */
export default function ChatPage() {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-xl font-semibold">Group chat</h1>
        <p className="text-sm text-muted-foreground">
          Everything that is not about one listing.
        </p>
      </div>
      <Thread
        listingId={null}
        className="h-[calc(100dvh-14rem)] min-h-72 md:h-[calc(100dvh-11rem)]"
      />
    </div>
  );
}
