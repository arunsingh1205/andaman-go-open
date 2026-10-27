"use server";

// Owner-only staff management (139) — invite a staff member by email, see
// who has access, revoke it. Mirrors the ops partner-onboarding flow
// (app/ops/partner-onboarding/cab/actions.ts) almost exactly: create the
// login with the Admin API before the person has ever signed in, generate a
// recovery-type link, send it as a "set your password" email. The one
// difference is what happens after createUser succeeds — that flow inserts
// a partner + listing; this one just adds one `admins` row via
// admin_add_staff, gated by is_admin_owner() in the database so a stray
// call from a non-owner session can't grant access no matter what this file
// does.

import { requireOwner } from "./admin-auth";
import { supabaseServer } from "./supabase-server";
import { supabaseAdmin } from "./supabase-admin";
import { sendAdminStaffInviteEmail } from "./email";

export type AdminActionResult = { ok: true; message: string } | { ok: false; message: string };

const GENERIC_FAILURE = "Something went wrong. Try again.";
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://andamango.in";

export type StaffMember = {
  userId: string;
  email: string;
  role: "owner" | "staff";
  createdAt: string;
};

function firstRow<T>(data: unknown): T | null {
  return Array.isArray(data) && data.length > 0 ? (data[0] as T) : null;
}

export async function listStaff(): Promise<StaffMember[]> {
  await requireOwner();
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("admin_list_staff");
  if (error || !data) return [];
  return (data as { user_id: string; email: string; role: string; created_at: string }[]).map(
    (row) => ({
      userId: row.user_id,
      email: row.email,
      role: row.role as "owner" | "staff",
      createdAt: row.created_at,
    }),
  );
}

/** Invites a new staff member: creates their login (Admin API — the same
 *  reason ops onboarding needs it, this account has never signed in
 *  before), grants staff access, and emails them a link to set a password.
 *  If sending the email fails, access is still granted — the failure is
 *  reported so the owner knows to pass the link along another way, not
 *  treated as if the invite itself failed. */
export async function inviteStaff(rawEmail: string): Promise<AdminActionResult> {
  await requireOwner();

  const email = rawEmail.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return { ok: false, message: "Enter a valid email address." };
  }

  const admin = supabaseAdmin();

  // A random password nobody is ever told — the account is only ever
  // reached through the recovery link below, same as ops onboarding's
  // temp password is only a fallback if that link's send fails.
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: crypto.randomUUID(),
    email_confirm: true,
  });
  if (createError || !created?.user) {
    return {
      ok: false,
      message: createError?.message?.includes("already been registered")
        ? "That email already has a login."
        : GENERIC_FAILURE,
    };
  }
  const newUserId = created.user.id;

  const supabase = await supabaseServer();
  const { data: addData, error: addError } = await supabase.rpc("admin_add_staff", {
    p_user_id: newUserId,
  });
  if (addError) {
    await admin.auth.admin.deleteUser(newUserId);
    return { ok: false, message: GENERIC_FAILURE };
  }
  const addRow = firstRow<{ ok: boolean; message: string }>(addData);
  if (!addRow?.ok) {
    await admin.auth.admin.deleteUser(newUserId);
    return { ok: false, message: addRow?.message ?? GENERIC_FAILURE };
  }

  // Same token_hash + verifyOtp approach as ops onboarding, and for the
  // same reason: the raw action_link's redirect can land as either a PKCE
  // `?code=` or a hash-fragment token depending on project config;
  // exchanging the hashed_token directly on our own /admin/set-password
  // page sidesteps that.
  const { data: linkData } = await admin.auth.admin.generateLink({ type: "recovery", email });
  const tokenHash = linkData?.properties?.hashed_token;
  const setPasswordUrl = tokenHash
    ? `${SITE_URL}/admin/set-password?token_hash=${encodeURIComponent(tokenHash)}&type=recovery`
    : `${SITE_URL}/admin/login`;

  const sent = await sendAdminStaffInviteEmail(email, setPasswordUrl).catch(() => false);

  return {
    ok: true,
    message: sent
      ? `Staff access granted. An email was sent to ${email}.`
      : `Staff access granted, but the invite email couldn't be sent — share this link directly: ${setPasswordUrl}`,
  };
}

export async function removeStaff(userId: string): Promise<AdminActionResult> {
  await requireOwner();

  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("admin_remove_staff", { p_user_id: userId });
  if (error) return { ok: false, message: GENERIC_FAILURE };
  const row = firstRow<{ ok: boolean; message: string }>(data);
  if (!row?.ok) return { ok: false, message: row?.message ?? GENERIC_FAILURE };
  return { ok: true, message: row.message };
}
