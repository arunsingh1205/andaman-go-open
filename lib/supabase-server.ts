// The client that runs on the server and knows who is asking.
//
// The browser client keeps the session in cookies, so a server component or a
// server action can read those cookies and act as that same person. That is
// what makes `auth.uid()` inside create_booking() return a real id — and
// therefore what makes "your bookings and nobody else's" work.

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SUPABASE_ANON_KEY, SUPABASE_URL, assertSupabaseEnv } from "./supabase-env";

export async function supabaseServer() {
  assertSupabaseEnv();
  const store = await cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Server components are not allowed to write cookies. That is fine:
          // the browser client refreshes the session on its own, so there is
          // nothing to save here. Only actions and route handlers need this
          // branch to succeed, and there it does.
        }
      },
    },

    // Same reasoning as lib/supabase.ts's catalogue client, but higher
    // stakes here: this client's reads are scoped to *whoever's cookies this
    // request carries*. Next.js's fetch Data Cache keys on URL + method, not
    // on the Authorization header those cookies produce — so without this,
    // one traveller's traveller_profiles row (phone, email) could get served
    // back to the next visitor who happened to hit the same route, most
    // visibly right after a log-out on /profile (always the same URL for
    // everyone). force-dynamic on the page stops the route itself from being
    // prerendered; this is what stops the individual reads inside it from
    // being cached across different people.
    global: {
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    },
  });
}
