"use server";

// Booking, from the app's side.
//
// This is deliberately thin. It does not know what anything costs, whether
// there is room, or what the reference should be — all of that lives in
// create_booking() in the database, where the check and the write happen
// together and cannot be skipped.
//
// What it does do is turn a database error into a sentence a traveller can
// act on. "23514" means somebody else got the last seats while this person
// was deciding, and that deserves better than a red stack trace.

import { supabaseServer } from "./supabase-server";
import { verifyPaymentSignature, refundPayment, fetchCapturedPayment } from "./razorpay";

// Every other network hop in the payment path (order creation, the
// order-status recovery check, the native sheet itself) is guarded with a
// timeout — see lib/razorpay.ts and lib/razorpay-client.ts. The actual
// booking write was not, which meant a stalled Supabase call (a lock, a
// pooler hiccup) left the traveller on "Confirming…" forever: the payment
// had already gone through, so none of the payment-side recovery logic ever
// ran, and nothing was logged because this file never traced anything.
//
// This does not cancel the underlying query — Postgres keeps running it —
// so a timeout here means "we stopped waiting", not "nothing happened".
// That is why a timeout is never treated as grounds to auto-refund the way
// a real database error is: the booking may still land a moment later.
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

export type BookingRequest = {
  kind: "activity" | "ferry" | "event" | "trip" | "rental";
  /** The slug, or the code for a ferry. */
  subject: string;
  /** When it starts, as an ISO instant. */
  startsAt: string;
  /** People, or seats. */
  party?: number;
  /** Days for a rental. One for everything else. */
  units?: number;
  /** Which vehicle, for a rental. */
  variant?: string | null;
  /** Hotel delivery, for a rental. */
  extras?: boolean;
  /** Which hotel to deliver a rental to — required when `extras` is true,
   *  ignored otherwise. Stored on booking_items.pickup_address (147), the
   *  same column a hotel-pickup trip uses. */
  deliveryHotel?: string;
  /**
   * How the traveller is paying: the whole price now, or a deposit (that
   * listing's own operator's commission, 138) with the rest owed in person.
   * Only offered where the category allows it (034); the database rejects a
   * deposit anywhere else, so this is a hint, not a
   * decision. Defaults to paying in full.
   */
  payMode?: "full" | "deposit";
  /**
   * The receipt Razorpay's checkout modal handed back after a real charge
   * (063). Required for 'activity' — create_booking rejects that kind
   * without one. Verified here, against the exact amount charged, before
   * create_booking ever runs; if the booking then fails anyway (the seat
   * went in the time it took to pay), the charge is refunded automatically.
   */
  razorpay?: {
    orderId: string;
    /** Absent when the payment sheet came back without one — see bookNow. */
    paymentId?: string;
    /** Likewise. Without it, the order is confirmed with Razorpay directly. */
    signature?: string;
    amountPaise: number;
  };
  /**
   * A flat-amount code (158) the traveller typed and had validated before
   * paying — see PromoCodeField. create_booking re-checks it and is the only
   * place it's ever actually redeemed; a stale/already-used code at this
   * point fails the booking rather than silently charging full price.
   */
  promoCode?: string;
};

export type BookingResult =
  | {
      ok: true;
      ref: string;
      ticket: string | null;
      pricePaise: number;
      state: "confirmed";
      /** What was taken online just now — the deposit, or the full price. */
      paidNowPaise: number;
      /** What is still owed in person, on the day. Zero when paid in full. */
      balancePaise: number;
    }
  | { ok: false; message: string };

type Row = {
  ref_code: string;
  ticket_code: string | null;
  price_paise: number;
  state: "confirmed";
  paid_online_paise: number;
  balance_paise: number;
};

export type FerryPassenger = {
  fullName: string;
  age: number;
  gender: "male" | "female" | "other";
  nationality: string;
  idType: "aadhaar" | "passport" | "driving-licence";
  idNumber: string;
};

/** One attendee on an event RSVP. Kids FREE_UNDER_AGE and under (lib/events.ts)
 *  are included here too, even though they don't need a ticket — the door
 *  still wants the headcount. */
export type EventGuest = {
  fullName: string;
  age: number;
};

/** One traveller on a trip, one per seat booked — there's no free-rider case
 *  here the way there is on an event RSVP. */
export type TripTraveller = {
  fullName: string;
  age: number;
};

/** One guest on an activity booking, one per seat — same shape as a trip
 *  traveller, and no free-age carve-out for the same reason. */
export type ActivityGuest = {
  fullName: string;
  age: number;
};

/**
 * A ferry booking is two writes: create_booking takes the seat and the money,
 * then save_ferry_passengers (039) records who is travelling — the operator
 * needs every name and ID before the ticket can be placed. Same two-step
 * shape as addPartnerVehicle + set_vehicle_security_deposit.
 */
export async function bookFerry(
  request: BookingRequest & { passengers: FerryPassenger[] },
): Promise<BookingResult> {
  const booked = await bookNow(request);
  if (!booked.ok) return booked;

  const supabase = await supabaseServer();
  const { data, error } = await withTimeout(
    supabase.rpc("save_ferry_passengers", {
      p_ref_code: booked.ref,
      p_passengers: request.passengers,
    }),
  ).catch((e) => ({ data: null, error: { message: e instanceof Error ? e.message : "timeout" } }));

  const row = (Array.isArray(data) ? data[0] : data) as
    | { ok: boolean; message: string }
    | undefined;

  if (error || !row?.ok) {
    // The seat and the payment went through; only the passenger list didn't.
    // Surface it so the traveller can retry from the confirmation screen.
    return {
      ok: false,
      message:
        row?.message ??
        "Your seats are held, but the passenger details didn't save. Open My bookings to add them.",
    };
  }

  return booked;
}

/**
 * An event RSVP is also two writes: create_booking takes the seats (the
 * over-3 headcount, already worked out by the RSVP form) and the money, then
 * save_event_guests (053) records everyone actually coming, including any
 * free-entry kids. Same shape as bookFerry above.
 */
export async function bookEvent(
  request: BookingRequest & { guests: EventGuest[] },
): Promise<BookingResult> {
  const booked = await bookNow(request);
  if (!booked.ok) return booked;

  const supabase = await supabaseServer();
  const { data, error } = await withTimeout(
    supabase.rpc("save_event_guests", {
      p_ref_code: booked.ref,
      p_guests: request.guests,
    }),
  ).catch((e) => ({ data: null, error: { message: e instanceof Error ? e.message : "timeout" } }));

  const row = (Array.isArray(data) ? data[0] : data) as
    | { ok: boolean; message: string }
    | undefined;

  if (error || !row?.ok) {
    return {
      ok: false,
      message:
        row?.message ??
        "Your spot is held, but the guest list didn't save. Open My bookings to add it.",
    };
  }

  return booked;
}

/**
 * A trip booking is also two writes: create_booking takes the seats and the
 * money, then save_trip_travellers (056) records who is actually going — one
 * per seat, name and age. Same shape as bookEvent/bookFerry above.
 */
export async function bookTrip(
  request: BookingRequest & { travellers: TripTraveller[]; hotelAddress?: string },
): Promise<BookingResult> {
  const booked = await bookNow(request);
  if (!booked.ok) return booked;

  const supabase = await supabaseServer();
  const { data, error } = await withTimeout(
    supabase.rpc("save_trip_travellers", {
      p_ref_code: booked.ref,
      p_travellers: request.travellers,
      p_hotel_address: request.hotelAddress ?? null,
    }),
  ).catch((e) => ({ data: null, error: { message: e instanceof Error ? e.message : "timeout" } }));

  const row = (Array.isArray(data) ? data[0] : data) as
    | { ok: boolean; message: string }
    | undefined;

  if (error || !row?.ok) {
    return {
      ok: false,
      message:
        row?.message ??
        "Your seat is held, but the traveller details didn't save. Open My bookings to add them.",
    };
  }

  return booked;
}

/**
 * An activity booking is also two writes: create_booking takes the seats and
 * the money, then save_activity_guests (068) records who is actually on it —
 * one per seat, name and age. Same shape as bookTrip/bookEvent above.
 */
export async function bookActivity(
  request: BookingRequest & { guests: ActivityGuest[] },
): Promise<BookingResult> {
  const booked = await bookNow(request);
  if (!booked.ok) return booked;

  const supabase = await supabaseServer();
  const { data, error } = await withTimeout(
    supabase.rpc("save_activity_guests", {
      p_ref_code: booked.ref,
      p_guests: request.guests,
    }),
  ).catch((e) => ({ data: null, error: { message: e instanceof Error ? e.message : "timeout" } }));

  const row = (Array.isArray(data) ? data[0] : data) as
    | { ok: boolean; message: string }
    | undefined;

  if (error || !row?.ok) {
    return {
      ok: false,
      message:
        row?.message ??
        "Your seat is held, but the guest details didn't save. Open My bookings to add them.",
    };
  }

  return booked;
}

export async function bookNow(request: BookingRequest): Promise<BookingResult> {
  const supabase = await supabaseServer();
  const razorpay = request.razorpay;

  // A real charge already happened in the browser before this ever runs
  // (Razorpay auto-captures on success) — this is the one place that decides
  // whether that charge earns a booking. Verify first: an unverified receipt
  // isn't proof of anything, and this server should never refund a payment
  // id it hasn't confirmed belongs to the order it created.
  // Two ways to prove a payment, and the second is the sturdier one.
  //
  // With a signature, re-compute the HMAC as before. Without one — which is
  // what happens when the app's native sheet returns a bare payment id, or
  // when the client recovered from a lost callback and has only the order id
  // — ask Razorpay what became of the order. That is strictly better
  // evidence: a signature attests that something holding our key secret
  // signed a pair of ids, while this is Razorpay itself reporting a captured
  // payment of a known amount against an order we created.
  //
  // Either way the amount is checked against what we are about to book, so a
  // client cannot pay ₹1 and claim a ₹5,000 seat.
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

  console.log(
    `[book] create_booking start kind=${request.kind} order=${razorpay?.orderId ?? "-"} payment=${paymentId ?? "-"}`,
  );

  let data, error;
  try {
    ({ data, error } = await withTimeout(
      supabase.rpc("create_booking", {
        p_kind: request.kind,
        p_subject: request.subject,
        p_starts_at: request.startsAt,
        p_party: request.party ?? 1,
        p_units: request.units ?? 1,
        p_variant: request.variant ?? null,
        p_extras: request.extras ?? false,
        p_pay_mode: request.payMode ?? "full",
        p_razorpay_order_id: razorpay?.orderId ?? null,
        p_razorpay_payment_id: paymentId,
        p_delivery_hotel: request.deliveryHotel ?? null,
        p_promo_code: request.promoCode ?? null,
      }),
    ));
  } catch {
    // We stopped waiting; Postgres may still finish the write a moment
    // later (create_booking's own p_razorpay_payment_id lookup at the top
    // makes a follow-up attempt idempotent, so this never double-books).
    // Refunding here would be wrong if the booking does land — so this
    // reports the stall and leaves the money alone, unlike a real database
    // error below.
    console.error(
      `[book] create_booking timed out kind=${request.kind} order=${razorpay?.orderId ?? "-"} payment=${paymentId ?? "-"}`,
    );
    return {
      ok: false,
      message: paymentId
        ? "This is taking longer than usual to confirm. Don't pay again — check My bookings in a " +
          `minute. If it's still not there, contact support with payment id ${paymentId}.`
        : "This is taking longer than usual. Please try again in a moment.",
    };
  }

  console.log(
    `[book] create_booking done kind=${request.kind} order=${razorpay?.orderId ?? "-"} ok=${!error}`,
  );

  if (error) {
    const refund =
      razorpay && paymentId ? await refundPayment(paymentId, razorpay.amountPaise) : null;
    return {
      ok: false,
      message: explain(error.code, error.message, Boolean(razorpay), refund !== null),
    };
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
    pricePaise: row.price_paise,
    state: row.state,
    paidNowPaise: row.paid_online_paise,
    balancePaise: row.balance_paise,
  };
}

/** Database errors, said out loud the way a person would say them. `paid` is
 *  true once a real Razorpay charge preceded the failed attempt — "nothing
 *  was charged" would be a lie at that point, so the wording switches to
 *  whether the refund that follows actually went through. */
function explain(code: string | undefined, message: string, paid = false, refunded = false): string {
  const money = paid
    ? refunded
      ? "Your payment has been refunded."
      : "Your payment could not be auto-refunded — contact support and it will be sorted out."
    : "Nothing was charged.";

  // Raised by create_booking when the seats ran out between looking and tapping.
  if (code === "23514" || /^only \d+ left$/.test(message)) {
    const left = message.match(/only (\d+) left/)?.[1];
    return left === "0"
      ? `That slot filled up while you were deciding. ${money} Try another time.`
      : `Only ${left} left now — somebody booked while you were deciding. ${money}`;
  }

  if (code === "42501" || message.includes("not signed in")) {
    return paid
      ? `We lost your session partway through. ${money} Reload the page and try again.`
      : "We could not start a session for you. Reload the page and try again.";
  }

  if (message.includes("nothing bookable found") || message.includes("runs at that time")) {
    return `That slot is no longer being offered. ${money} Pick another.`;
  }

  // Raised by create_booking (021) when the operator has closed that date.
  if (message.includes("closed to bookings")) {
    return `The operator has closed that date. ${money} Try another day.`;
  }

  // Raised by create_booking (141) when a ferry/event's start time is under
  // 2 hours away — the app hides these before this is ever reachable, so
  // seeing it means the traveller had the page open a while.
  if (message.includes("booking window closed for this time")) {
    return `Booking closes 2 hours before it starts, and that time's passed. ${money} Pick a later time.`;
  }

  // Raised by create_booking (035) when a rental pick-up falls outside the
  // shop's opening hours for that day.
  if (message.includes("not open for pick-up")) {
    return `The shop isn't open for pick-up then. ${money} Pick a time within their hours.`;
  }

  // Raised by create_booking (147) when "Deliver to my hotel" is checked but
  // no hotel name came with it — the app validates this before charging, so
  // seeing it means a stale page.
  if (message.includes("hotel name is required")) {
    return `Add a hotel name for delivery. ${money} Reload and try again.`;
  }

  // Raised by create_booking (034) if a deposit is asked for where the
  // category only takes full payment. The screen shouldn't offer it, so this
  // is a stale page.
  if (message.includes("has to be paid in full")) {
    return `This one has to be paid in full. ${money} Reload and try again.`;
  }

  // Raised by create_booking (063/066) when this kind has a real price but
  // no payment id came with the request — normally a stale page still
  // running pre-payment code, since every current booking screen pays first.
  if (message.includes("verified payment is required")) {
    return "This page is out of date and can't take a payment. Reload and try again.";
  }

  // Raised by create_booking (158) when the code stopped being valid, or got
  // redeemed elsewhere, between "Apply" and paying — PromoCodeField checks it
  // up front, so seeing this means a race with the code's own one-time use.
  if (message.includes("code is not valid")) {
    return `That code isn't valid any more. ${money} Remove it and try again.`;
  }
  if (message.includes("code has already been used")) {
    return `That code's already been used on your account. ${money} Remove it and try again.`;
  }

  // Raised by create_booking (160) when a code scoped to other listings, or
  // gated behind a minimum order, stops matching between "Apply" and
  // paying (guest count dropped below the minimum, say) — PromoCodeField
  // checks both up front, so seeing either here means something changed
  // after that check ran.
  if (message.includes("code does not apply to this booking")) {
    return `That code doesn't apply to this booking. ${money} Remove it and try again.`;
  }
  if (message.includes("code needs a higher order amount")) {
    return `That code needs a bigger order to apply. ${money} Remove it and try again.`;
  }

  return `Something went wrong. ${money} Try again.`;
}
