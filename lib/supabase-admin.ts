// The one place the app holds the Supabase service_role key. It ignores
// every RLS policy, so this client must never be imported by a client
// component and must never leak into a NEXT_PUBLIC_ variable — the anon
// client in lib/supabase.ts is what everything else in the app should use.
//
// Exists only for the ops partner-onboarding flow, which needs
// auth.admin.createUser()/generateLink() to create a partner's login on
// their behalf before that partner has ever signed in themselves — the
// Admin API is the only way to do that server-side; every other account in
// this app creates itself via supabase-browser.ts's anon client.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// .trim() guards against a stray trailing newline/space from a copy-paste
// into an env var UI — invisible in the field, but enough to corrupt the
// `Authorization: Bearer <key>` header and make Supabase's Auth server see
// it as no token at all (its actual error is the unhelpful "no_authorization").
const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

export function supabaseAdmin(): SupabaseClient {
  if (!url || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY (and NEXT_PUBLIC_SUPABASE_URL) must be set as server env vars to create partner logins from ops onboarding.",
    );
  }

  // A fresh client per call, not a module-level singleton — this only ever
  // runs inside a handful of Server Action calls, never on a hot path, so
  // there's no connection-reuse benefit worth the risk of some other module
  // accidentally importing a shared privileged client.
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
