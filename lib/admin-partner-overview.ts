"use server";

// The extras an admin needs on a partner's detail page that the review
// queue never surfaced: who has access, what's pending, whether a payout
// account is on file, upcoming closures. Read-only.
//
// Cancellation policy used to live here too, per partner. It's now one flat
// platform rule (034/036), so there's nothing partner-specific to show.

import { supabaseServer } from "./supabase-server";

export type AdminTeamMember = { email: string | null; role: string };
export type AdminInvite = { email: string; role: string };
export type AdminClosure = { onDate: string; reason: string };

export type AdminPartnerOverview = {
  team: AdminTeamMember[];
  invites: AdminInvite[];
  hasPayoutAccount: boolean;
  closures: AdminClosure[];
};

export async function getAdminPartnerOverview(
  partnerId: string,
): Promise<AdminPartnerOverview> {
  const supabase = await supabaseServer();
  const todayIso = new Date().toISOString().slice(0, 10);

  const [team, invites, payout, closures] = await Promise.all([
    supabase.rpc("admin_partner_team", { p_partner_id: partnerId }),
    supabase.rpc("admin_partner_invites", { p_partner_id: partnerId }),
    supabase.from("payout_accounts").select("partner_id").eq("partner_id", partnerId).maybeSingle(),
    supabase
      .from("listing_closures")
      .select("on_date, reason")
      .eq("partner_id", partnerId)
      .gte("on_date", todayIso)
      .order("on_date")
      .limit(6),
  ]);

  return {
    team: (team.data ?? []).map((m: { email: string | null; role: string }) => ({
      email: m.email,
      role: m.role,
    })),
    invites: (invites.data ?? []).map((i: { email: string; role: string }) => ({
      email: i.email,
      role: i.role,
    })),
    hasPayoutAccount: Boolean(payout.data),
    closures: (closures.data ?? []).map((c) => ({
      onDate: c.on_date as string,
      reason: c.reason as string,
    })),
  };
}
