"use server";

// A business's own commission rate (partners.commission_bps, migration 137)
// — negotiated per partner when the admin reviews their registration, not
// one flat rate per booking category. The write is set_partner_commission,
// which re-checks is_admin() itself; the read lives with the rest of a
// partner's detail-page data in lib/admin-review.ts (PendingPartner).

import { supabaseServer } from "./supabase-server";

export type CommissionResult = { ok: boolean; message: string };

export async function setPartnerCommission(
  partnerId: string,
  bps: number,
): Promise<CommissionResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("set_partner_commission", {
    p_partner_id: partnerId,
    p_bps: bps,
  });
  if (error) return { ok: false, message: "Couldn't save that. Try again." };
  const row = Array.isArray(data) ? (data[0] as { ok: boolean; message: string }) : null;
  return { ok: Boolean(row?.ok), message: row?.message ?? "Couldn't save that." };
}
