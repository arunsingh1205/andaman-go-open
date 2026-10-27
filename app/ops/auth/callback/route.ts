// Where Google sends an ops user back after they approve sign-in. Mirrors
// /admin/auth/callback/route.ts exactly, just landing in the ops section
// instead — the onboarding layout there decides ops vs. not-ops from
// whoever this session turns out to be.

import { supabaseServer } from "@/lib/supabase-server";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");

  if (code) {
    const supabase = await supabaseServer();
    await supabase.auth.exchangeCodeForSession(code);
  }

  return Response.redirect(new URL("/ops/partner-onboarding", url.origin));
}
