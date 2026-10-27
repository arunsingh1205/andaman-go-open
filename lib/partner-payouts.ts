"use server";

// The bank / UPI details a partner puts on file for when payouts run. Read
// and write both go through the per-user server client; the write is the
// scoped set_payout_account RPC (025), which validates the IFSC / UPI shape.

import { supabaseServer } from "./supabase-server";

export type PayoutAccount = {
  accountName: string | null;
  accountNumber: string | null;
  ifsc: string | null;
  upiId: string | null;
};

export type PayoutResult = { ok: boolean; message: string };

export async function getPayoutAccount(partnerId: string): Promise<PayoutAccount | null> {
  const supabase = await supabaseServer();

  const { data } = await supabase
    .from("payout_accounts")
    .select("account_name, account_number, ifsc, upi_id")
    .eq("partner_id", partnerId)
    .maybeSingle();

  if (!data) return null;

  return {
    accountName: data.account_name,
    accountNumber: data.account_number,
    ifsc: data.ifsc,
    upiId: data.upi_id,
  };
}

export async function savePayoutAccount(input: {
  accountName: string;
  accountNumber: string;
  ifsc: string;
  upiId: string;
}): Promise<PayoutResult> {
  const supabase = await supabaseServer();

  const { data, error } = await supabase.rpc("set_payout_account", {
    p_account_name: input.accountName,
    p_account_number: input.accountNumber,
    p_ifsc: input.ifsc,
    p_upi_id: input.upiId,
  });

  if (error) return { ok: false, message: "Couldn't save that. Try again." };

  const row = Array.isArray(data) ? (data[0] as { ok: boolean; message: string }) : null;
  return { ok: Boolean(row?.ok), message: row?.message ?? "Couldn't save that." };
}
