"use server";

// Booking a stay, from the app's side. Thin, like lib/cab-book.ts: the price,
// the commission split, and the "is this room type free across those nights"
// check all live in create_stay_booking() (migration 097), where the check
// and the write happen together and can't be skipped. This file only turns a
// database error into a sentence a traveller can act on.

import { supabaseServer } from "./supabase-server";
import { verifyPaymentSignature, refundPayment, fetchCapturedPayment } from "./razorpay";
import { notifyStayWebhook } from "./stay-webhook";

// Same reasoning as lib/book.ts's withTimeout, and the same idempotent
// p_razorpay_payment_id lookup at the top of create_stay_booking makes a
// follow-up attempt safe.
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

export type StayBookingRequest = {
  /** The property's slug. */
  stay: string;
  /** The room type's code. */
  roomType: string;
  /** Check-in date, "YYYY-MM-DD". */
  checkIn: string;
  nights: number;
  party: number;
  /**
   * "partial" — pay Andaman Go's commission online now, the rest at the
   * property; "full" — pay the whole stay online now. (097)
   */
  payMode: "partial" | "full";
  /**
   * The receipt Razorpay's checkout handed back after charging the online
   * amount. Required for every stay booking — create_stay_booking rejects a
   * booking without a verified payment. Verified here before the RPC ever
   * runs; if the booking then fails anyway (the room got taken in the
   * meantime), the charge is refunded automatically.
   */
  razorpay?: {
    orderId: string;
    paymentId: string;
    signature: string;
    amountPaise: number;
  };
};

export type StayBookingResult =
  | {
      ok: true;
      ref: string;
      ticket: string | null;
      pricePaise: number;
      paidNowPaise: number;
      balancePaise: number;
    }
  | { ok: false; message: string };

type Row = {
  ref_code: string;
  ticket_code: string | null;
  price_paise: number;
  paid_online_paise: number;
  balance_paise: number;
  item_id: string;
};

export async function bookStay(request: StayBookingRequest): Promise<StayBookingResult> {
  const supabase = await supabaseServer();
  const razorpay = request.razorpay;

  // Two ways to prove a payment — same as lib/book.ts's bookNow. The native
  // iOS checkout's resume-recovery path (lib/razorpay-client.ts) has no
  // signature to hand back and returns signature: "" rather than omitting
  // it, which verifyPaymentSignature would always reject regardless of
  // whether Razorpay actually captured the money — exactly the "paid but no
  // booking" failure this fixes. Without a real signature, ask Razorpay
  // directly instead.
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
      supabase.rpc("create_stay_booking", {
        p_stay: request.stay,
        p_room_type: request.roomType,
        p_check_in: request.checkIn,
        p_nights: request.nights,
        p_party: request.party,
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

  // Awaited (bounded to a few seconds inside notifyStayWebhook) rather than
  // fired-and-forgotten: a serverless function can be frozen the instant its
  // response is sent, which would silently kill an in-flight fetch left
  // running behind it. A failure here never changes the booking result.
  await notifyStayWebhook(row.item_id, {
    event: "booking.created",
    bookingItemId: row.item_id,
    refCode: row.ref_code,
    ticketCode: row.ticket_code,
    roomTypeCode: request.roomType,
    checkIn: request.checkIn,
    nights: request.nights,
    party: request.party,
    pricePaise: row.price_paise,
    payMode: request.payMode,
    paidOnlinePaise: row.paid_online_paise,
    balancePaise: row.balance_paise,
    createdAt: new Date().toISOString(),
  }).catch(() => {});

  return {
    ok: true,
    ref: row.ref_code,
    ticket: row.ticket_code,
    pricePaise: row.price_paise,
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
  if (message.includes("sleeps at most")) {
    return message.replace(/^.*(that room type sleeps at most \d+).*$/i, "$1") + `. ${money}`;
  }
  if (message.includes("only") && message.includes("left")) {
    return `Somebody booked that room type for those nights while you were deciding. ${money} Try another date or room type.`;
  }
  if (message.includes("closed to bookings")) {
    return `The property has closed some of those nights. ${money} Try another date.`;
  }
  if (message.includes("nothing bookable found")) {
    return `That stay or room type is no longer being offered. ${money} Pick another.`;
  }
  if (message.includes("verified payment is required")) {
    return "This page is out of date and can't take a payment. Reload and try again.";
  }
  return `Something went wrong. ${money} Try again.`;
}
