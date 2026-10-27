import { NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/lib/razorpay";
import { supabase } from "@/lib/supabase";

// Razorpay's server calling ours — no browser, no session, no cookies. The
// only thing that separates a real delivery from anyone who finds this URL
// and posts a fake "refund processed" is the signature over the raw body,
// so that check has to happen before anything here is trusted, and the
// database write it leads to (apply_razorpay_refund_webhook, 067) is granted
// to anon for exactly that reason — this route is the actual gate, not RLS.
//
// Configure in the Razorpay dashboard: Settings → Webhooks → add
// https://<your-domain>/api/razorpay/webhook, subscribed to refund.processed
// and refund.failed, then put the secret it generates in
// RAZORPAY_WEBHOOK_SECRET.

type RefundEvent = {
  event: string;
  payload?: {
    refund?: {
      entity?: {
        id?: string;
        payment_id?: string;
      };
    };
  };
};

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-razorpay-signature");

  if (!signature) {
    return NextResponse.json({ message: "Missing signature." }, { status: 400 });
  }

  let verified: boolean;
  try {
    verified = verifyWebhookSignature(rawBody, signature);
  } catch {
    return NextResponse.json({ message: "Webhook not configured." }, { status: 500 });
  }

  if (!verified) {
    return NextResponse.json({ message: "Invalid signature." }, { status: 400 });
  }

  let event: RefundEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ message: "Bad request." }, { status: 400 });
  }

  const status =
    event.event === "refund.processed" ? "processed" : event.event === "refund.failed" ? "failed" : null;

  // Every other subscribed-or-not event (refund.created, payment.captured,
  // whatever gets added later) is acknowledged and ignored rather than
  // erroring — Razorpay retries a non-2xx response, and there is nothing
  // for this route to retry towards for an event it doesn't act on.
  if (!status) {
    return NextResponse.json({ ok: true });
  }

  const refundId = event.payload?.refund?.entity?.id;
  const paymentId = event.payload?.refund?.entity?.payment_id;
  if (!refundId || !paymentId) {
    return NextResponse.json({ message: "Missing refund fields." }, { status: 400 });
  }

  const { error } = await supabase.rpc("apply_razorpay_refund_webhook", {
    p_razorpay_payment_id: paymentId,
    p_razorpay_refund_id: refundId,
    p_status: status,
  });

  if (error) {
    return NextResponse.json({ message: "Could not record the refund." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
