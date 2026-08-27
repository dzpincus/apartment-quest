import { FollowUpQueue } from "@/components/queue/follow-up-queue";
import { QueueHeadline } from "@/components/queue/queue-headline";
import { UnreadStrip } from "@/components/unread-strip";
import { ActivityFeed } from "@/components/activity-feed";

/** SPEC: "The default landing screen. Not a listing gallery." */
export default function HomePage() {
  return (
    <div className="grid gap-5">
      <QueueHeadline />
      {/* Above the queue chips and below the title: what the house said comes
          before what the brokers are owed, and it renders nothing when there
          is nothing unread. */}
      <UnreadStrip />
      <FollowUpQueue />
      <ActivityFeed />
    </div>
  );
}
