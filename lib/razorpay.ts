// Razorpay — order creation and payment-signature verification.
//
// Standard Checkout works in two steps that only ever talk to each other
// through Razorpay: this server asks Razorpay for an order id, the browser
// opens Razorpay's own modal with that id, and Razorpay hands the browser a
// signed receipt once the card/UPI/etc. actually clears. That receipt is
// only trustworthy once this server re-derives the signature with the key
// secret and finds a match — the modal succeeding is not proof of payment on
// its own, since a script in the browser could fake the success callback.
//
// The env check is lazy (inside keys(), not at module load) on purpose:
// lib/book.ts imports this file and lib/book.ts runs every booking kind, not
// just activities. A module-scope throw here would mean a missing Razorpay
// key breaks ferry and trip bookings too, and — worse — breaks the build
// itself, since Next.js evaluates route modules while collecting page data.

import Razorpay from "razorpay";
import crypto from "crypto";

export const MIN_AMOUNT_PAISE = 100;

// The razorpay npm SDK wraps axios internally with no timeout configured
// (and no way to pass one in through its public constructor options — the
// axios instance it builds isn't part of its exported types either), so a
// slow Razorpay API response hangs this call until the platform's own
// function timeout kills it. This doesn't cancel the underlying request the
// way an AbortController does (lib/email.ts, lib/whatsapp.ts,
// lib/stay-webhook.ts all can, since they use plain fetch) — it just stops
// *this* call from waiting on it forever, so checkout and refunds fail fast
// with a normal error instead of hanging.
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Razorpay call timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function keys(): { keyId: string; keySecret: string } {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    throw new Error(
      [
        "Razorpay is not configured.",
        "",
        "Add these to .env.local (test keys from the Razorpay dashboard, under",
        "Settings → API Keys), and to your deployment's environment variables:",
        "",
        "  RAZORPAY_KEY_ID=rzp_test_...",
        "  RAZORPAY_KEY_SECRET=...",
        "  NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_test_...",
        "",
        "Then restart the dev server (or redeploy).",
      ].join("\n"),
    );
  }
  return { keyId, keySecret };
}

let client: Razorpay | null = null;

function getRazorpay(): Razorpay {
  if (!client) {
    const { keyId, keySecret } = keys();
    client = new Razorpay({ key_id: keyId, key_secret: keySecret });
  }
  return client;
}

export async function createOrder(opts: {
  amountPaise: number;
  currency: string;
  receipt?: string;
}): Promise<{ id: string; amount: number; currency: string }> {
  const order = await withTimeout(
    getRazorpay().orders.create({
      amount: opts.amountPaise,
      currency: opts.currency,
      receipt: opts.receipt,
    }),
    8000,
  );
  return { id: order.id, amount: Number(order.amount), currency: order.currency };
}

/**
 * Ask Razorpay what actually happened to an order, rather than believing what
 * the client brought back.
 *
 * The receipt used to be the only proof a booking would accept: the checkout
 * handed the browser an order id, payment id and signature, and the server
 * re-computed the HMAC. That works right up until the client never comes back
 * — which is exactly what the app did, because the native sheet's callback
 * was never reached. The money had gone and nothing was recorded.
 *
 * This is the stronger proof anyway. A signature says "someone holding our
 * key secret signed this pair"; this says "Razorpay itself reports a captured
 * payment of this amount against the order we created". It needs nothing from
 * the client but the order id.
 *
 * Returns null when nothing has been captured, so a caller can tell "not paid"
 * apart from "paid, here it is".
 */
export async function fetchCapturedPayment(
  orderId: string,
): Promise<{ paymentId: string; amountPaise: number } | null> {
  const list = (await withTimeout(getRazorpay().orders.fetchPayments(orderId), 8000)) as {
    items?: Array<{ id?: string; status?: string; amount?: number | string }>;
  };

  // "captured" only. An "authorized" payment is money held but not taken, and
  // a booking made against one would be a booking that might never be paid
  // for; Razorpay's own auto-capture means a real success is captured.
  const paid = (list.items ?? []).find((p) => p.status === "captured" && typeof p.id === "string");
  if (!paid?.id) return null;

  return { paymentId: paid.id, amountPaise: Number(paid.amount ?? 0) };
}

/** Recomputes Razorpay's signature the same way they do, so a mismatch means
 *  the payment either failed or the payload was tampered with in transit. */
export function verifyPaymentSignature(opts: {
  orderId: string;
  paymentId: string;
  signature: string;
}): boolean {
  const { keySecret } = keys();
  const expected = crypto
    .createHmac("sha256", keySecret)
    .update(`${opts.orderId}|${opts.paymentId}`)
    .digest("hex");

  // Fixed-time comparison — a signature check that returns early on the
  // first mismatched byte leaks how much of the guess was right.
  const a = Buffer.from(expected);
  const b = Buffer.from(opts.signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Money back for a payment Razorpay already captured but that didn't end in a
 * booking — a seat that ran out between paying and create_booking's own
 * check, say — or for a cancellation, where the amount is whatever the
 * cancellation policy already decided is owed back. Best-effort: if
 * Razorpay's API is unreachable the caller still needs to tell the traveller
 * something, so this returns null rather than throwing and leaves the
 * payment for manual refund in the Razorpay dashboard. Returns the refund id
 * on success — refunds aren't instant, so this is "accepted", not "settled";
 * the webhook (app/api/razorpay/webhook) is what learns the final outcome.
 */
export async function refundPayment(
  paymentId: string,
  amountPaise: number,
): Promise<{ id: string } | null> {
  try {
    const refund = await withTimeout(
      getRazorpay().payments.refund(paymentId, { amount: amountPaise }),
      8000,
    );
    return { id: refund.id };
  } catch {
    return null;
  }
}

/**
 * Razorpay signs webhook deliveries with HMAC-SHA256 of the raw request body
 * (not a field inside it, unlike the checkout signature) using a secret you
 * set once when creating the webhook in the dashboard — separate from
 * RAZORPAY_KEY_SECRET. This is what stops anyone who finds the webhook URL
 * from posting fake "refund processed" events.
 */
export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error(
      [
        "RAZORPAY_WEBHOOK_SECRET is not configured.",
        "",
        "Create a webhook in the Razorpay dashboard (Settings → Webhooks) pointing",
        "at https://<your-domain>/api/razorpay/webhook, subscribed to the",
        "refund.processed and refund.failed events, then copy the secret it",
        "generates into RAZORPAY_WEBHOOK_SECRET in .env.local and your deployment's",
        "environment variables.",
      ].join("\n"),
    );
  }

  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
