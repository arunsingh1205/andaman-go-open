"use server";

// The traveller cancelling one item of a booking (032). The DB enforces
// whose booking it is and whether it's still inside the operator's free-
// cancellation window and decides exactly how much comes back (067); this
// file's only extra job beyond that bridge is turning that decision into a
// real Razorpay refund when the booking was actually paid online.

import { supabaseServer } from "./supabase-server";
import { refundPayment } from "./razorpay";

export type CancelResult = { ok: boolean; message: string };

export async function cancelBookingItem(itemId: string): Promise<CancelResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("cancel_my_booking_item", { p_item_id: itemId });
  if (error) return { ok: false, message: "Couldn't cancel that. Try again." };

  const row = Array.isArray(data)
    ? (data[0] as {
        ok: boolean;
        message: string;
        razorpay_payment_id: string | null;
        refund_paise: number | null;
      })
    : null;
  if (!row?.ok) return { ok: false, message: row?.message ?? "Couldn't cancel that." };

  // The cancellation already happened — this only decides whether Razorpay
  // needs telling. A deposit or a cab's part-payment (neither refundable), or
  // an inside-24-hours cancel all come back here with nothing to refund.
  if (row.razorpay_payment_id && row.refund_paise && row.refund_paise > 0) {
    const refund = await refundPayment(row.razorpay_payment_id, row.refund_paise);
    if (refund) {
      await supabase.rpc("record_razorpay_refund", {
        p_item_id: itemId,
        p_razorpay_refund_id: refund.id,
        p_status: "processing",
      });
    }
    // If the Razorpay call itself failed, the booking is still correctly
    // cancelled — refund_status just stays null, same as a cash booking,
    // until someone processes it manually from the Razorpay dashboard.
  }

  return { ok: true, message: row.message };
}
