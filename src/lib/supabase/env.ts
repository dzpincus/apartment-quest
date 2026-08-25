/**
 * Supabase env vars. Read lazily so a build without env (CI, `pnpm build`)
 * never crashes — we only throw when a client is actually created at runtime.
 */
export function supabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return { url, key };
}

export function requireSupabaseEnv() {
  const { url, key } = supabaseEnv();
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. Copy .env.example to .env.local.",
    );
  }
  return { url, key };
}

export function hasSupabaseEnv() {
  const { url, key } = supabaseEnv();
  return Boolean(url && key);
}
