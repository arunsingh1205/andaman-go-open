"use server";

// A booking arrives already paid and confirmed (034) — there's nothing for a
// partner to accept any more. What's left is the opposite: "I genuinely can't
// run this one." partner_cancel_booking_item (034) refunds the traveller in
// full and frees the slot; this file is the thin bridge from a button press
// to that RPC.

import { supabaseServer } from "./supabase-server";
import { refundPayment } from "./razorpay";

export type PartnerActionResult = { ok: boolean; message: string };

type CancelRow = {
  ok: boolean;
  message: string;
  razorpay_payment_id: string | null;
  refund_paise: number | null;
} | null | undefined;

function firstRow(data: unknown): CancelRow {
  return Array.isArray(data) ? (data[0] as CancelRow) : null;
}

export async function cancelPartnerBooking(
  itemId: string,
  reason: string,
): Promise<PartnerActionResult> {
  if (reason.trim() === "") {
    return { ok: false, message: "Add a reason — the traveller sees this." };
  }

  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("partner_cancel_booking_item", {
    p_item_id: itemId,
    p_reason: reason.trim(),
  });

  if (error) return { ok: false, message: "Couldn't cancel that. Try again." };

  const row = firstRow(data);
  if (!row?.ok) return { ok: false, message: row?.message ?? "Couldn't cancel that." };

  // The operator backing out makes the traveller whole (067) — actually
  // tell Razorpay to send the money back, not just the database.
  if (row.razorpay_payment_id && row.refund_paise && row.refund_paise > 0) {
    const refund = await refundPayment(row.razorpay_payment_id, row.refund_paise);
    if (refund) {
      await supabase.rpc("record_razorpay_refund", {
        p_item_id: itemId,
        p_razorpay_refund_id: refund.id,
        p_status: "processing",
      });
    }
  }

  return { ok: true, message: row.message };
}

/** Stamp every unread notification for this partner as seen — called when the
 *  Notifications screen opens. Failure is silent: an unread badge that lingers
 *  a bit longer is nobody's emergency. */
export async function markNotificationsRead(): Promise<void> {
  const supabase = await supabaseServer();
  await supabase.rpc("mark_partner_notifications_read");
}
