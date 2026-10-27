// Where Google sends an admin back after they approve sign-in. Mirrors
// /partner/auth/callback/route.ts exactly, just landing in the admin section
// instead — the dashboard layout there decides admin vs. not-admin from
// whoever this session turns out to be.

import { supabaseServer } from "@/lib/supabase-server";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");

  if (code) {
    const supabase = await supabaseServer();
    await supabase.auth.exchangeCodeForSession(code);
  }

  return Response.redirect(new URL("/admin/partners", url.origin));
}
