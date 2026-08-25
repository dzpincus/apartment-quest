import { FollowUpQueue } from "@/components/queue/follow-up-queue";
import { ActivityFeed } from "@/components/activity-feed";

/** SPEC: "The default landing screen. Not a listing gallery." */
export default function HomePage() {
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-semibold">Follow-up queue</h1>
        <p className="text-sm text-muted-foreground">
          Brokers stop replying to people who go quiet. Work the top down.
        </p>
      </div>

      <FollowUpQueue />
      <ActivityFeed />
    </div>
  );
}
