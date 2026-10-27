// Who is holding the phone, on the admin side.
//
// There is no admin sign-up, anywhere, on purpose — unlike partners, nobody
// self-serves their way into the `admins` table. Arun links his own account
// in by hand, once, in the SQL editor (see 012-admin-review.sql's header
// comment) — the same manual step partner accounts used before 011 added
// self-onboarding. Everyone else who signs in at /admin lands on
// /admin/not-linked with no form to fill in, because there shouldn't be one.
//
// Same three-state shape as getPartnerAuthState(), for the same reason:
// signed-out, signed-in-but-not-admin, and admin are three different
// screens, not two.
//
// Wrapped in React's cache() for the same reason as the partner side: the
// dashboard layout and the page under it both check this per request, and
// this collapses that into one auth round trip. signOutAdmin() lives in its
// own file (admin-signout.ts) rather than here — see partner-auth.ts for
// why a real Server Action can't share a file with a cache()-wrapped read.

import { cache } from "react";
import { redirect } from "next/navigation";
import { supabaseServer } from "./supabase-server";

// The email rides along so the console can show who is signed in — with no
// admin sign-up and no admin profile screen, this is the only place an admin
// ever gets told which account they're acting as, which matters on a console
// that can suspend a business.
//
// `role` (139) is 'owner' (full access — historically the only kind) or
// 'staff' (everything except Revenue, Settlements, Communications and the
// Staff screen itself). is_admin() in the database still means "either
// role" — role only matters to the handful of screens that check it here,
// on the Next.js side; see requireOwner() below.
export type AdminSession = { userId: string; email: string | null; role: "owner" | "staff" };

export type AdminAuthState =
  | { status: "signed-out" }
  | { status: "not-admin"; email: string | null }
  | { status: "admin"; session: AdminSession };

export const getAdminAuthState = cache(async (): Promise<AdminAuthState> => {
  const supabase = await supabaseServer();

  const { data: userResult, error: userError } = await supabase.auth.getUser();
  const user = userResult?.user;
  if (userError || !user) return { status: "signed-out" };

  const { data: row, error: rowError } = await supabase
    .from("admins")
    .select("user_id, role")
    .eq("user_id", user.id)
    .maybeSingle();

  if (rowError || !row) return { status: "not-admin", email: user.email ?? null };

  return {
    status: "admin",
    session: { userId: user.id, email: user.email ?? null, role: row.role as "owner" | "staff" },
  };
});

/** Convenience for screens that only care whether there's a working admin session. */
export async function getAdminSession(): Promise<AdminSession | null> {
  const state = await getAdminAuthState();
  return state.status === "admin" ? state.session : null;
}

/** The guard for the three owner-only sections (Revenue, Settlements,
 *  Communications) and the Staff screen itself — call at the top of each
 *  page.tsx (or once in a layout.tsx for a section with subpages) and
 *  render nothing else if it returns false. The dashboard layout has
 *  already handled signed-out/not-admin by the time any of these run; this
 *  only adds the narrower "admin, but not the owner" case, which the
 *  layout itself lets through since staff needs every other section. The
 *  database's own is_admin_owner() check on each of those sections' actual
 *  RPCs/policies is the real gate — this is the UI courtesy that keeps a
 *  staff member from landing on a page that would just error on every
 *  action anyway. Redirects rather than returning a boolean so a caller
 *  can't forget to act on a `false`. */
export async function requireOwner(): Promise<void> {
  const session = await getAdminSession();
  if (session?.role !== "owner") {
    redirect("/admin/overview");
  }
}
