"use server";

// A partner's own view of the weekly settlement (101) — what's pending,
// what's already been paid, across every category, not just stays. Read-
// only: a partner can see their own batches via RLS, but every write
// (running a batch, marking it paid) is an admin-only action.

import { supabaseServer } from "./supabase-server";

export type SettlementBatch = {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: "pending" | "paid";
  grossPaise: number;
  commissionPaise: number;
  cashCollectedPaise: number;
  netPayablePaise: number;
  itemCount: number;
  paidAt: string | null;
  payoutReference: string | null;
};

export async function getMySettlementBatches(): Promise<SettlementBatch[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("settlement_batches")
    .select(
      "id, period_start, period_end, status, gross_paise, commission_paise, cash_collected_paise, net_payable_paise, item_count, paid_at, payout_reference",
    )
    .order("period_start", { ascending: false });

  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    status: row.status as "pending" | "paid",
    grossPaise: row.gross_paise,
    commissionPaise: row.commission_paise,
    cashCollectedPaise: row.cash_collected_paise,
    netPayablePaise: row.net_payable_paise,
    itemCount: row.item_count,
    paidAt: row.paid_at,
    payoutReference: row.payout_reference,
  }));
}
