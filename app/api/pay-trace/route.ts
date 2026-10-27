import { NextResponse } from "next/server";

// A breadcrumb trail for payments made inside the app.
//
// The app is a WebView on somebody else's phone: there is no console to read
// and no Safari Web Inspector without a Mac. When a payment goes through and
// the booking doesn't appear, the difference between "the native sheet never
// called back", "it called back and the promise was lost", and "the booking
// action failed" is the whole diagnosis — and none of it is visible from
// here, because a client that hangs never reaches the server to say so.
//
// So each stage of a native payment posts one line. Vercel's runtime log then
// shows how far it got, which is enough to tell those three cases apart.
//
// Deliberately minimal: no database, no auth, console.log only, and a hard
// cap on what it echoes. It records the stage and the Razorpay order id — ids
// we created ourselves and that already sit in our own tables — and nothing
// a payment could be made with.

export const dynamic = "force-dynamic";

const MAX = 200;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  const { stage, orderId, detail } = (body ?? {}) as {
    stage?: unknown;
    orderId?: unknown;
    detail?: unknown;
  };

  const clean = (v: unknown) =>
    typeof v === "string" ? v.slice(0, MAX).replace(/[\r\n]+/g, " ") : "";

  console.log(
    `[pay-trace] stage=${clean(stage) || "?"} order=${clean(orderId) || "-"} detail=${clean(detail) || "-"}`,
  );

  return new NextResponse(null, { status: 204 });
}
