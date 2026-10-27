// Who is holding the phone, on the ops side — the role that onboards
// partners on-site, distinct from Partner and Admin. Same shape as
// admin-auth.ts and the same reasoning: no ops sign-up, ever. Arun links an
// ops teammate's account in by hand, once, in the SQL editor (see
// 131-ops-onboarding.sql's header comment) — the same manual step admin
// accounts use. Everyone else who signs in at /ops lands on /ops/not-linked
// with no form to fill in.
//
// Same three-state shape as getAdminAuthState()/getPartnerAuthState(), for
// the same reason: signed-out, signed-in-but-not-ops, and ops are three
// different screens, not two.
//
// Wrapped in React's cache() for the same reason as the admin/partner
// sides: the onboarding layout and the page under it both check this per
// request, and this collapses that into one auth round trip.
// signOutOps() lives in its own file (ops-signout.ts) rather than here —
// see partner-auth.ts for why a real Server Action can't share a file with
// a cache()-wrapped read.

import { cache } from "react";
import { supabaseServer } from "./supabase-server";

export type OpsSession = { userId: string; email: string | null };

export type OpsAuthState =
  | { status: "signed-out" }
  | { status: "not-ops"; email: string | null }
  | { status: "ops"; session: OpsSession };

export const getOpsAuthState = cache(async (): Promise<OpsAuthState> => {
  const supabase = await supabaseServer();

  const { data: userResult, error: userError } = await supabase.auth.getUser();
  const user = userResult?.user;
  if (userError || !user) return { status: "signed-out" };

  const { data: row, error: rowError } = await supabase
    .from("ops_users")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (rowError || !row) return { status: "not-ops", email: user.email ?? null };

  return { status: "ops", session: { userId: user.id, email: user.email ?? null } };
});

/** Convenience for screens that only care whether there's a working ops session. */
export async function getOpsSession(): Promise<OpsSession | null> {
  const state = await getOpsAuthState();
  return state.status === "ops" ? state.session : null;
}
