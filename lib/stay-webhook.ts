"use server";

// Outbound half of the partner API (099/103) — a best-effort POST to a
// partner's own webhook_url right after their stay booking succeeds, so a
// partner running their own booking system doesn't have to poll
// GET /api/partner/v1/bookings to find out. The pull endpoint stays the
// reliable path: this is fire-once, not retried, and a failure here never
// undoes or blocks the booking that already went through — every call site
// wraps this in its own try/catch.

import crypto from "crypto";
import { supabaseServer } from "./supabase-server";

export type StayWebhookPayload = {
  event: "booking.created";
  bookingItemId: string;
  refCode: string;
  ticketCode: string | null;
  roomTypeCode: string;
  checkIn: string;
  nights: number;
  party: number;
  pricePaise: number;
  payMode: "partial" | "full";
  paidOnlinePaise: number;
  balancePaise: number;
  createdAt: string;
};

function sign(secret: string, body: string): string {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

export async function notifyStayWebhook(
  bookingItemId: string,
  payload: StayWebhookPayload,
): Promise<void> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("get_stay_webhook_targets", {
    p_booking_item_id: bookingItemId,
  });
  if (error || !data) return;

  const targets = data as { webhook_url: string; webhook_secret: string }[];
  if (targets.length === 0) return;

  const body = JSON.stringify(payload);

  await Promise.allSettled(
    targets.map((t) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      return fetch(t.webhook_url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-andaman-signature": `sha256=${sign(t.webhook_secret, body)}`,
        },
        body,
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));
    }),
  );
}
