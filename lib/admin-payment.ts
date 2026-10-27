"use server";

// Per-category payment mode — the admin's other rate-card lever (034).
// 'free' takes nothing, 'full' takes the whole price online, 'choice' lets
// the traveller pay a deposit (that listing's own operator's commission,
// 138). Read is a plain scoped select (the modes are public — the booking
// screens read them); the write is set_category_payment, which re-checks
// is_admin() itself.

import { supabaseServer } from "./supabase-server";
import type { BookingKind } from "./bookings";
import type { PaymentMode } from "./payments";

export type CategoryPayment = { kind: BookingKind; mode: PaymentMode };

export type PaymentResult = { ok: boolean; message: string };

export async function getCategoryPayments(): Promise<CategoryPayment[]> {
  const supabase = await supabaseServer();
  const { data } = await supabase.from("category_payment").select("kind, mode").order("kind");
  return (data ?? []).map((r) => ({
    kind: r.kind as BookingKind,
    mode: r.mode as PaymentMode,
  }));
}

export async function setCategoryPayment(
  kind: BookingKind,
  mode: PaymentMode,
): Promise<PaymentResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("set_category_payment", {
    p_kind: kind,
    p_mode: mode,
  });
  if (error) return { ok: false, message: "Couldn't save that. Try again." };
  const row = Array.isArray(data) ? (data[0] as { ok: boolean; message: string }) : null;
  return { ok: Boolean(row?.ok), message: row?.message ?? "Couldn't save that." };
}
