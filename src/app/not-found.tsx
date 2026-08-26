/**
 * 404. Reached by a stale link to a deleted listing, or a typed URL. The way
 * back is the queue, since that is the screen the app is actually about.
 */

import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Not found.</h1>
        <p className="text-sm text-muted-foreground">
          That page doesn&apos;t exist — it may have been merged away.
        </p>
      </div>
      <Link href="/" className="text-sm underline underline-offset-4">
        Back to the queue
      </Link>
    </main>
  );
}
