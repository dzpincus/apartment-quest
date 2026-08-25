import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Providers } from "@/app/providers";
import { PersonProvider } from "@/lib/person";
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
      <PersonProvider>
        <Nav />
        <main className="mx-auto w-full max-w-5xl px-4 pt-4 pb-24 md:pb-8">
          {children}
        </main>
      </PersonProvider>
    </Providers>
  );
}
