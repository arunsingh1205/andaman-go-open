"use server";

// Booking against the standardized rate card, from the app's side. Thin,
// like lib/cab-book.ts: the fare lookup and the payment-required guard both
// live in create_ratecard_cab_booking() (migration 078). This file only
// turns a database error into a sentence a traveller can act on.
//
// Unlike lib/cab-book.ts, a successful booking here never carries a ticket —
// no car or driver is attached yet, so `ticket` always comes back null. The
// traveller sees "your driver's details will be shared shortly" until an
// admin runs admin_assign_cab_operator (082) and hands it to one of the
// existing partner-cab accounts.

import { supabaseServer } from "./supabase-server";
import { verifyPaymentSignature, refundPayment, fetchCapturedPayment } from "./razorpay";
import type { CabRateTripType } from "./cab-rate-card";
import type { CabCategory } from "./cabs";

// Same reasoning as lib/book.ts's withTimeout, and the same idempotent
// p_razorpay_payment_id lookup at the top of create_ratecard_cab_booking
// makes a follow-up attempt safe.
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

export type RateCardBookingRequest = {
  islandSlug: string;
  tripType: CabRateTripType;
  vehicleCategory: CabCategory;
  /** cab_places ids. Null pickup means "any pickup in the standard zone";
   *  null drop only applies to the local point-to-point fare. */
  fromPlaceId: string | null;
  toPlaceId: string | null;
  /** ISO instant of pickup. */
  startsAt: string;
  /** Required (088) — dispatch needs a name and a working number before
   *  anyone can be sent to find this person. */
  travellerName: string;
  travellerPhone: string;
  pickupNote?: string;
  /** The browser's own location permission, dropped as a pin alongside the
   *  named pickup — the exact spot, not just the nearest landmark (081). */
  pickupLat?: number | null;
  pickupLng?: number | null;
  /** "partial" — pay Andaman Go's commission online now, the rest to
   *  whichever driver is assigned; "full" — pay the whole fare online now. */
  payMode: "partial" | "full";
  /**
   * The receipt Razorpay's checkout handed back. Required for every cab
   * booking (073) — create_ratecard_cab_booking rejects a booking without a
   * verified payment. Verified here before the RPC ever runs; if the
   * booking then fails anyway, the charge is refunded automatically.
   */
  razorpay: {
    orderId: string;
    paymentId: string;
    signature: string;
    amountPaise: number;
  };
};

export type RateCardBookingResult =
  | {
      ok: true;
      ref: string;
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

export async function bookRateCardCab(
  request: RateCardBookingRequest,
): Promise<RateCardBookingResult> {
  const supabase = await supabaseServer();
  const razorpay = request.razorpay;

  // Two ways to prove a payment — same as lib/book.ts's bookNow. The native
  // iOS checkout's resume-recovery path (lib/razorpay-client.ts) has no
  // signature to hand back and returns signature: "" rather than omitting
  // it, which verifyPaymentSignature would always reject regardless of
  // whether Razorpay actually captured the money — exactly the "paid but no
  // booking" failure this fixes. Without a real signature, ask Razorpay
  // directly instead.
  let paymentId = razorpay.paymentId;

  if (razorpay.signature) {
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

  let data, error;
  try {
    ({ data, error } = await withTimeout(
      supabase.rpc("create_ratecard_cab_booking", {
        p_island_slug: request.islandSlug,
        p_from_place_id: request.fromPlaceId,
        p_to_place_id: request.toPlaceId,
        p_trip_type: request.tripType,
        p_vehicle_category: request.vehicleCategory,
        p_starts_at: request.startsAt,
        p_traveller_name: request.travellerName,
        p_traveller_phone: request.travellerPhone,
        p_pickup_note: request.pickupNote ?? "",
        p_pay_mode: request.payMode,
        p_razorpay_order_id: razorpay.orderId,
        p_razorpay_payment_id: paymentId,
        p_pickup_lat: request.pickupLat ?? null,
        p_pickup_lng: request.pickupLng ?? null,
      }),
    ));
  } catch {
    return {
      ok: false,
      message:
        "This is taking longer than usual to confirm. Don't pay again — check My bookings in a " +
        `minute. If it's still not there, contact support with payment id ${paymentId}.`,
    };
  }

  if (error) {
    console.error(`[cab-ratecard] create_ratecard_cab_booking failed: ${error.message}`);
    const refund = await refundPayment(paymentId, razorpay.amountPaise);
    return { ok: false, message: explain(error.message, refund !== null) };
  }

  const row = (Array.isArray(data) ? data[0] : data) as Row | undefined;
  if (!row) {
    const refund = await refundPayment(paymentId, razorpay.amountPaise);
    return {
      ok: false,
      message:
        refund !== null
          ? "The booking did not come back. Your payment has been refunded."
          : "The booking did not come back. Contact support with your payment id.",
    };
  }

  return {
    ok: true,
    ref: row.ref_code,
    farePaise: row.fare_paise,
    paidNowPaise: row.paid_online_paise,
    balancePaise: row.balance_paise,
  };
}

function explain(message: string, refunded: boolean): string {
  const money = refunded
    ? "Your payment has been refunded."
    : "Your payment could not be auto-refunded — contact support and it will be sorted out.";

  if (message.includes("not signed in")) {
    return "We could not start a session for you. Reload the page and try again.";
  }
  if (message.includes("no fare set")) {
    return "This trip isn't on the rate card yet. Pick another destination.";
  }
  if (message.includes("name is required")) {
    return "Add your name so a driver knows who they're picking up.";
  }
  if (message.includes("does not look like a phone number")) {
    return "That doesn't look like a phone number. A 10-digit mobile is enough.";
  }
  if (message.includes("verified payment is required")) {
    return "This page is out of date and can't take a payment. Reload and try again.";
  }
  return `Something went wrong. ${money} Try again.`;
}
