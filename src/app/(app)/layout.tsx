import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Providers } from "@/app/providers";
import { PersonProvider } from "@/lib/person";
import { RealtimeProvider } from "@/lib/realtime";
import { NotificationsProvider } from "@/components/notifications-provider";
import { Nav } from "@/components/nav";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <Providers>
      {/* Inside Providers: the channel's only job is invalidating the query cache. */}
      <RealtimeProvider>
        {/* Inside PersonProvider: it needs to know who you are before it can
            work out that a message is not yours. Its own channel, because
            RealtimeProvider above is invalidation-only by rule and this one
            reads the row. */}
        <PersonProvider>
          <NotificationsProvider>
            <Nav />
            {/* `overflow-x-hidden` is a backstop, not the fix: nothing inside
              should be wider than the phone, and the toolbar and the cards are
              built so it is not. It is here so that the day something is, the
              page still cannot be dragged sideways with every card's right
              edge hanging off the screen. */}
            {/* The bottom padding clears the floating tab bar *and* the home
              indicator under it — the bar itself sits on
              `mb-max(1.25rem,env(safe-area-inset-bottom))`, so the page has to
              pay the same inset or the last card's "No fee" line hides behind
              it on a notched phone. */}
            <main className="mx-auto w-full max-w-5xl overflow-x-hidden px-4 pt-2 pb-[calc(8rem+env(safe-area-inset-bottom))] md:pt-4 md:pb-8">
              {children}
            </main>
          </NotificationsProvider>
        </PersonProvider>
      </RealtimeProvider>
    </Providers>
  );
}
