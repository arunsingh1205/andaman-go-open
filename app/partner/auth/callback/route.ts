// Where Google sends the partner back after they approve sign-in.
//
// This has to be a route handler, not a page — exchanging the code for a
// session is a one-time server-side step that also needs to set cookies,
// and only route handlers (and server actions) are allowed to do that. Once
// it's done, plain navigation takes over: the dashboard layout looks at
// who's now signed in and sends them to bookings, or to /partner/not-linked
// if this Google account isn't attached to a business yet.

import { supabaseServer } from "@/lib/supabase-server";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");

  if (code) {
    const supabase = await supabaseServer();
    await supabase.auth.exchangeCodeForSession(code);
  }

  return Response.redirect(new URL("/partner/bookings", url.origin));
}
