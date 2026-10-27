// The two values every Supabase client needs, looked up in one place.
//
// Supabase has renamed the key variable twice, so all three names are accepted
// rather than making you rename whatever their Connect panel handed you.

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_OR_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  "";

export function assertSupabaseEnv() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      [
        "Supabase is not configured.",
        "",
        "Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to",
        ".env.local, then stop and restart the dev server — Next.js only reads",
        "environment variables when it boots.",
      ].join("\n"),
    );
  }
}
