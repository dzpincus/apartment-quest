"use client";

/**
 * The last stop for a render that threw. Without it Next serves its own blank
 * "Application error" page, which tells four people looking at a phone
 * absolutely nothing and offers no way back.
 *
 * `reset` re-renders the segment, which is the right retry for what actually
 * throws here: a Supabase client built without env, or a fetcher that lost the
 * network. The message is shown rather than hidden — one shared login, no
 * boundary, and the person reading it is the person who can fix it.
 */

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("render error", error);
  }, [error]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Something broke.</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          {error.message || "No details — check the console."}
        </p>
        {error.digest && (
          <p className="text-xs text-muted-foreground">Digest: {error.digest}</p>
        )}
      </div>
      <Button onClick={reset}>Try again</Button>
    </main>
  );
}
