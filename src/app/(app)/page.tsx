import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">Follow-up queue</h1>
      <p className="text-sm text-muted-foreground">
        Overdue, today, and cold listings land here in phase 3, with the activity feed
        below them.
      </p>
      <Button size="sm" render={<Link href="/listings" />}>
        Go to listings
      </Button>
    </div>
  );
}
