"use server";

// Promo code validation (158, scope/percent/minimum-order 160) — a
// read-only preview. The actual redemption (the write that consumes a
// code's one-time-per-traveller use) only ever happens inside
// create_booking, at the moment a booking is placed; this just lets the
// "Apply" button show "₹200 off" before that, without burning the code on
// a checkout the traveller abandons. kind/subject/orderPaise are what
// create_booking itself will check the code against — the same listing
// and the same pre-discount order amount — so a code that's scoped to one
// activity, or that needs a minimum order, fails here exactly the way it
// would at the moment of paying.

import { supabaseServer } from "./supabase-server";

export type PromoCheck =
  | { ok: true; discountPaise: number }
  | { ok: false; message: string };

type Row = { ok: boolean; message: string; discount_paise: number | null };

export async function validatePromoCode(
  code: string,
  kind: "activity" | "trip",
  subject: string,
  orderPaise: number,
): Promise<PromoCheck> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("validate_promo_code", {
    p_code: code,
    p_kind: kind,
    p_subject: subject,
    p_order_paise: orderPaise,
  });

  const row = (Array.isArray(data) ? data[0] : data) as Row | undefined;

  if (error || !row) {
    return { ok: false, message: "Couldn't check that code. Try again." };
  }
  if (!row.ok || row.discount_paise == null) {
    return { ok: false, message: row.message };
  }
  return { ok: true, discountPaise: row.discount_paise };
}
