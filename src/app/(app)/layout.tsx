import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Providers } from "@/app/providers";
import { PersonProvider } from "@/lib/person";
import { RealtimeProvider } from "@/lib/realtime";
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
        <PersonProvider>
          <Nav />
          {/* `overflow-x-hidden` is a backstop, not the fix: nothing inside
              should be wider than the phone, and the toolbar and the cards are
              built so it is not. It is here so that the day something is, the
              page still cannot be dragged sideways with every card's right
              edge hanging off the screen. */}
          <main className="mx-auto w-full max-w-5xl overflow-x-hidden px-4 pt-2 pb-32 md:pt-4 md:pb-8">
            {children}
          </main>
        </PersonProvider>
      </RealtimeProvider>
    </Providers>
  );
}
