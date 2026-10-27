"use server";

// Booking a cab, from the app's side. Thin, like lib/book.ts: the fare, the
// airport / night surcharges, and the "is this car free on that date" check
// all live in create_cab_booking() (migration 049), where the check and the
// write happen together and can't be skipped. This file only turns a database
// error into a sentence a traveller can act on.

import { supabaseServer } from "./supabase-server";
import { verifyPaymentSignature, refundPayment, fetchCapturedPayment } from "./razorpay";
import type { CabTripType } from "./cabs";

// Same reasoning as lib/book.ts's withTimeout, and the same idempotent
// p_razorpay_payment_id lookup at the top of create_cab_booking makes a
// follow-up attempt safe — a stalled RPC here used to leave the traveller on
// "Booking…" forever with the payment already captured, since nothing else
// in this file was going to notice or retry it.
const RPC_TIMEOUT_MS = 15000;

function withTimeout<T>(promise: PromiseLike<T>, ms = RPC_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("rpc-timeout")), ms);
    Promise.resolve(promise).then(
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

export type CabBookingRequest = {
  /** The operator's slug. */
  operator: string;
  /** The car's code. */
  cab: string;
  tripType: CabTripType;
  /** cab_places ids. Omitted for a full-day hire. */
  fromPlaceId?: string | null;
  toPlaceId?: string | null;
  /** ISO instant of pickup. */
  startsAt: string;
  /** Return date (YYYY-MM-DD) for a round trip. */
  returnDate?: string | null;
  /** Days, for a full-day hire. */
  days?: number;
  pickupNote?: string;
  /**
   * "partial" — pay Andaman Go's commission online now, the rest to the
   * driver; "full" — pay the whole fare online now. (073)
   */
  payMode: "partial" | "full";
  /**
   * The receipt Razorpay's checkout handed back after charging the online
   * amount. Required for every cab booking now (073) — create_cab_booking
   * rejects a booking without a verified payment. Verified here before the
   * RPC ever runs; if the booking then fails anyway (the car got taken in
   * the meantime), the charge is refunded automatically.
   */
  razorpay?: {
    orderId: string;
    paymentId: string;
    signature: string;
    amountPaise: number;
  };
};

export type CabBookingResult =
  | {
      ok: true;
      ref: string;
      ticket: string | null;
      farePaise: number;
      paidNowPaise: number;
      balancePaise: number;
    }
  | { ok: false; message: string };

type Row = {
  ref_code: string;
  ticket_code: string | null;
  fare_paise: number;
  paid_online_paise: number;
  balance_paise: number;
};

export async function bookCab(request: CabBookingRequest): Promise<CabBookingResult> {
  const supabase = await supabaseServer();
  const razorpay = request.razorpay;

  // Two ways to prove a payment — same as lib/book.ts's bookNow, and for the
  // same reason: the native iOS checkout's resume-recovery path (see
  // lib/razorpay-client.ts) has no signature to hand back, only a bare
  // payment id, and returns signature: "" rather than omitting the field.
  // Falling straight to verifyPaymentSignature on that empty string is what
  // was actually happening here — it fails every single time regardless of
  // whether Razorpay really captured the money, which is exactly the "paid
  // but no booking" report this fixes. Without a real signature, ask
  // Razorpay directly what happened to the order instead.
  let paymentId = razorpay?.paymentId ?? null;

  if (razorpay) {
    if (razorpay.signature && razorpay.paymentId) {
      const verified = verifyPaymentSignature({
        orderId: razorpay.orderId,
        paymentId: razorpay.paymentId,
        signature: razorpay.signature,
      });
      if (!verified) {
        return {
          ok: false,
          message:
            "We couldn't verify that payment. If money left your account, contact support with " +
            `payment id ${razorpay.paymentId} and it will be looked into.`,
        };
      }
    } else {
      const captured = await fetchCapturedPayment(razorpay.orderId).catch(() => null);
      if (!captured) {
        return {
          ok: false,
          message:
            "We couldn't confirm that payment with Razorpay. Nothing has been booked — " +
            `if money left your account, quote ${razorpay.orderId} to support and it will be sorted out.`,
        };
      }
      if (captured.amountPaise !== razorpay.amountPaise) {
        return {
          ok: false,
          message:
            "The amount paid doesn't match this booking. Nothing has been booked — " +
            `quote ${razorpay.orderId} to support and it will be sorted out.`,
        };
      }
      paymentId = captured.paymentId;
    }
  }

  let data, error;
  try {
    ({ data, error } = await withTimeout(
      supabase.rpc("create_cab_booking", {
        p_operator: request.operator,
        p_cab: request.cab,
        p_trip_type: request.tripType,
        p_from: request.fromPlaceId ?? null,
        p_to: request.toPlaceId ?? null,
        p_starts_at: request.startsAt,
        p_return_date: request.returnDate ?? null,
        p_days: request.days ?? 1,
        p_pickup_note: request.pickupNote ?? "",
        p_pay_mode: request.payMode,
        p_razorpay_order_id: razorpay?.orderId ?? null,
        p_razorpay_payment_id: paymentId,
      }),
    ));
  } catch {
    return {
      ok: false,
      message: paymentId
        ? "This is taking longer than usual to confirm. Don't pay again — check My bookings in a " +
          `minute. If it's still not there, contact support with payment id ${paymentId}.`
        : "This is taking longer than usual. Please try again in a moment.",
    };
  }

  if (error) {
    console.error(`[cab-book] create_cab_booking failed: ${error.message}`);
    const refund =
      razorpay && paymentId ? await refundPayment(paymentId, razorpay.amountPaise) : null;
    return { ok: false, message: explain(error.message, Boolean(razorpay), refund !== null) };
  }

  const row = (Array.isArray(data) ? data[0] : data) as Row | undefined;
  if (!row) {
    const refund =
      razorpay && paymentId ? await refundPayment(paymentId, razorpay.amountPaise) : null;
    const refunded = refund !== null;
    return {
      ok: false,
      message: refunded
        ? "The booking did not come back. Your payment has been refunded."
        : "The booking did not come back. Nothing was charged.",
    };
  }

  return {
    ok: true,
    ref: row.ref_code,
    ticket: row.ticket_code,
    farePaise: row.fare_paise,
    paidNowPaise: row.paid_online_paise,
    balancePaise: row.balance_paise,
  };
}

function explain(message: string, paid = false, refunded = false): string {
  const money = paid
    ? refunded
      ? "Your payment has been refunded."
      : "Your payment could not be auto-refunded — contact support and it will be sorted out."
    : "Nothing was charged.";

  if (message.includes("not signed in")) {
    return "We could not start a session for you. Reload the page and try again.";
  }
  if (message.includes("no fare set") || message.includes("no route")) {
    return "This car isn't set up for that route yet. Pick another car or another route.";
  }
  if (message.includes("already booked") || message.includes("car is booked")) {
    return `That car was just booked for those dates. ${money} Try another car.`;
  }
  if (message.includes("closed to bookings")) {
    return `The operator has closed that date. ${money} Try another day.`;
  }
  if (message.includes("verified payment is required")) {
    return "This page is out of date and can't take a payment. Reload and try again.";
  }
  return `Something went wrong. ${money} Try again.`;
}
