"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({
        // Internal identifier for the single shared account. Never rendered.
        email: process.env.NEXT_PUBLIC_APP_LOGIN_EMAIL!,
        password,
      });
      if (error) {
        setError("Wrong password.");
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-5 rounded-[24px] border-2 border-border bg-card p-6"
      >
        <div className="space-y-1">
          <h1 className="text-[28px] leading-tight">Apartment Quest</h1>
          <p className="text-sm text-muted-foreground">
            Four people, one lease. Password, please.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            autoFocus
            className="h-11 rounded-full bg-inset px-4"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={pending || !password}
        >
          {pending ? "Checking..." : "Enter"}
        </Button>
      </form>
    </main>
  );
}
