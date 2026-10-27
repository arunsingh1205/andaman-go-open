import { NextResponse } from "next/server";
import { fetchCapturedPayment } from "@/lib/razorpay";

// "Did order X actually get paid?" — asked of Razorpay, not of the client.
//
// This is what turns a lost payment callback from a disaster into a hiccup.
// The app's native sheet can finish, take the money, and fail to hand the
// receipt back (a backgrounded app during a UPI switch is enough to do it).
// Before this endpoint the money was simply gone, with no booking and no
// record. Now the client only has to remember which order it tried to pay,
// and the server finds out the rest.
//
// Safe to expose: it takes an order id we generated, returns only whether
// that one order has a captured payment and for how much, and reveals
// nothing about anybody else. Order ids are unguessable, and knowing one is
// paid grants nothing on its own — lib/book.ts still checks the amount
// against the thing being booked before it writes anything.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let orderId: unknown;
  try {
    ({ orderId } = (await request.json()) as { orderId?: unknown });
  } catch {
    return NextResponse.json({ message: "Bad request." }, { status: 400 });
  }

  if (typeof orderId !== "string" || !orderId.startsWith("order_")) {
    return NextResponse.json({ message: "Bad request." }, { status: 400 });
  }

  try {
    const captured = await fetchCapturedPayment(orderId);
    if (!captured) return NextResponse.json({ paid: false });

    return NextResponse.json({
      paid: true,
      paymentId: captured.paymentId,
      amountPaise: captured.amountPaise,
    });
  } catch (error) {
    // Razorpay unreachable is not "not paid" — saying so would let a client
    // conclude nothing was charged when something was.
    console.error("[order-status] lookup failed:", error);
    return NextResponse.json({ message: "Could not check that payment." }, { status: 502 });
  }
}
