"use server";

// The team behind a business: who's linked, who's been invited. All writes
// are owner-only, enforced in the RPCs (026); this file is the thin bridge.

import { supabaseServer } from "./supabase-server";
import { getPartnerSession } from "./partner-auth";
import { sendTeamInviteEmail } from "./email";

export type TeamMember = {
  memberId: string;
  email: string | null;
  role: "owner" | "staff";
  isYou: boolean;
};

export type PendingInvite = {
  id: string;
  email: string;
  role: "owner" | "staff";
};

export type PartnerTeam = {
  members: TeamMember[];
  invites: PendingInvite[];
};

export type MyInvite = {
  inviteId: string;
  partnerName: string;
  role: "owner" | "staff";
};

export type TeamResult = { ok: boolean; message: string };

function firstRow(data: unknown): { ok: boolean; message: string } | null {
  return Array.isArray(data) ? (data[0] as { ok: boolean; message: string }) : null;
}

export async function getPartnerTeam(partnerId: string): Promise<PartnerTeam> {
  const supabase = await supabaseServer();

  const [{ data: userResult }, membersResult, invitesResult] = await Promise.all([
    supabase.auth.getUser(),
    supabase.rpc("partner_team"),
    supabase
      .from("partner_invites")
      .select("id, email, role")
      .eq("partner_id", partnerId)
      .is("accepted_at", null)
      .order("created_at", { ascending: true }),
  ]);

  const myId = userResult.user?.id ?? null;

  const members: TeamMember[] = (
    (membersResult.data ?? []) as {
      member_id: string;
      email: string | null;
      role: "owner" | "staff";
    }[]
  ).map((row) => ({
    memberId: row.member_id,
    email: row.email,
    role: row.role,
    isYou: row.member_id === myId,
  }));

  const invites: PendingInvite[] = (invitesResult.data ?? []).map((row) => ({
    id: row.id as string,
    email: row.email as string,
    role: row.role as "owner" | "staff",
  }));

  return { members, invites };
}

export async function invitePartnerMember(
  email: string,
  role: "owner" | "staff" = "staff",
): Promise<TeamResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("invite_partner_staff", {
    p_email: email,
    p_role: role,
  });
  if (error) return { ok: false, message: "Couldn't send that invite. Try again." };
  const row = firstRow(data);
  const ok = Boolean(row?.ok);

  // The invite row is what actually matters — it's still visible in-app the
  // next time the invited person signs in even if this send fails or isn't
  // configured (email.ts), so a failure here shouldn't fail the invite. It's
  // still awaited (rather than fired-and-forgotten) since a serverless
  // function can be frozen the instant this action returns.
  if (ok) {
    const session = await getPartnerSession();
    if (session) {
      await sendTeamInviteEmail(email, session.partnerName, role).catch((err) =>
        console.error("sendTeamInviteEmail failed:", err),
      );
    }
  }

  return { ok, message: row?.message ?? "Couldn't send that invite." };
}

export async function revokePartnerInvite(inviteId: string): Promise<TeamResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("revoke_partner_invite", { p_invite_id: inviteId });
  if (error) return { ok: false, message: "Couldn't do that. Try again." };
  const row = firstRow(data);
  return { ok: Boolean(row?.ok), message: row?.message ?? "Couldn't do that." };
}

export async function removePartnerStaff(userId: string): Promise<TeamResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("remove_partner_staff", { p_user_id: userId });
  if (error) return { ok: false, message: "Couldn't do that. Try again." };
  const row = firstRow(data);
  return { ok: Boolean(row?.ok), message: row?.message ?? "Couldn't do that." };
}

export async function getMyPendingInvites(): Promise<MyInvite[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("my_pending_invites");
  if (error || !data) return [];
  return (data as { invite_id: string; partner_name: string; role: "owner" | "staff" }[]).map(
    (row) => ({ inviteId: row.invite_id, partnerName: row.partner_name, role: row.role }),
  );
}

export async function acceptPartnerInvite(inviteId: string): Promise<TeamResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("accept_partner_invite", { p_invite_id: inviteId });
  if (error) return { ok: false, message: "Couldn't accept that. Try again." };
  const row = firstRow(data);
  return { ok: Boolean(row?.ok), message: row?.message ?? "Couldn't accept that." };
}
