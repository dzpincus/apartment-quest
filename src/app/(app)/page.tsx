import { FollowUpQueue } from "@/components/queue/follow-up-queue";
import { QueueHeadline } from "@/components/queue/queue-headline";
import { ActivityFeed } from "@/components/activity-feed";

/** SPEC: "The default landing screen. Not a listing gallery." */
export default function HomePage() {
  return (
    <div className="grid gap-5">
      <QueueHeadline />
      <FollowUpQueue />
      <ActivityFeed />
    </div>
  );
}
