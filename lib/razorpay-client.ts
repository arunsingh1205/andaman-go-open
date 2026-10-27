// The browser half of Razorpay Standard Checkout — loading their script and
// typing the bits of window.Razorpay this app actually uses. Shared by
// app/razorpay-checkout-button.tsx (the standalone pay button) and any
// booking panel that needs to open the same modal itself, so the script only
// gets loaded once no matter how many of these end up on a page.

import type { NativeCheckoutResult } from "./razorpay-native";
import { trackMeta } from "./meta-events";

const CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

export type RazorpayOptions = {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description?: string;
  order_id: string;
  handler: (response: {
    razorpay_order_id: string;
    razorpay_payment_id: string;
    razorpay_signature: string;
  }) => void;
  modal?: { ondismiss?: () => void };
  theme?: { color?: string };
};

export type RazorpayInstance = {
  open: () => void;
  on: (event: "payment.failed", handler: (response: { error: { description: string } }) => void) => void;
};

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

export function loadRazorpayCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  const existing = document.querySelector(`script[src="${CHECKOUT_SRC}"]`);
  if (existing) {
    return new Promise((resolve) => existing.addEventListener("load", () => resolve()));
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = CHECKOUT_SRC;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load the payment script."));
    document.body.appendChild(script);
  });
}

/** Below this, Razorpay's own ₹1 order minimum rejects the charge — callers
 *  skip the modal entirely under this (a free table, a kid-only RSVP). */
export const MIN_CHARGE_PAISE = 100;

/** A receipt unique per attempt, max 40 chars — Razorpay's own limit. Lives
 *  here (not inline in a booking panel) so the impure Date.now() call sits
 *  outside every component body; React's purity check flags it otherwise. */
export function makeReceipt(prefix: string): string {
  return `${prefix}-${Date.now()}`.slice(0, 40);
}

export type PaidReceipt = {
  orderId: string;
  paymentId: string;
  signature: string;
  amountPaise: number;
};

/** Long enough for a UPI app switch and a slow bank; short enough that
 *  nobody stares at a stuck button for the rest of the evening. */
const PAY_TIMEOUT_MS = 4 * 60 * 1000;

const TIMEOUT = "pay-timeout";

/**
 * One line to the server per stage of a native payment — see
 * app/api/pay-trace/route.ts for why this exists at all. Fire and forget: a
 * failed breadcrumb must never be the thing that breaks a payment.
 */
function trace(stage: string, orderId?: string, detail?: string): void {
  try {
    void fetch("/api/pay-trace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage, orderId, detail }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // ignored on purpose
  }
}

/**
 * Ask our server whether Razorpay has a captured payment for this order, and
 * give a bank a few seconds to catch up before concluding it hasn't.
 *
 * Returns the payment id, or null when nothing was captured. A 502 (Razorpay
 * unreachable) is treated as "don't know yet" and retried, because reading it
 * as "not paid" is how somebody gets charged and told nothing happened.
 */
async function recoverPayment(orderId: string): Promise<string | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2500));
    try {
      const res = await fetch("/api/razorpay/order-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      if (!res.ok) continue;
      const body = (await res.json()) as { paid?: boolean; paymentId?: string };
      if (body.paid && body.paymentId) return body.paymentId;
    } catch {
      // network blip — try again
    }
  }
  return null;
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(TIMEOUT)), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Opens the Razorpay modal for one amount and resolves with the receipt to
 * hand to a booking action, or rejects with a message fit to show the
 * traveller — cancelling the modal and a declined payment both reject rather
 * than resolving with nothing, so every booking screen can use one try/catch
 * instead of juggling a callback.
 */
export async function chargeViaRazorpay(opts: {
  amountPaise: number;
  receipt: string;
  name?: string;
  description?: string;
}): Promise<PaidReceipt> {
  // In the app, hand the whole thing to Razorpay's native sheet instead of
  // their web modal. The web modal works, but inside a WKWebView it runs in
  // an iframe, and an iframe cannot hand a upi:// URL to iOS — Capacitor only
  // forwards non-http schemes for top-level navigations. So the modal falls
  // back to asking for a typed UPI ID, which is the worst way to pay in
  // India, and the iframe brings its own sizing problems on a notched phone.
  // The native SDK switches to Google Pay / PhonePe / Paytm itself.
  //
  // Only the presentation changes. Our server still creates the order and
  // still re-verifies the signature (lib/book.ts), because the native SDK
  // returns the same three fields the web handler does.
  // isNativePlatform(), not getPlatform() === "ios": that used to be
  // deliberately narrower, because capacitor-plugins/razorpay-native shipped
  // iOS sources only and the Android app would have called a plugin that
  // wasn't there and failed every payment. Now that the plugin has a real
  // android/ implementation (Razorpay's native Android Checkout SDK, same
  // reasoning as iOS: a upi:// URL can't be handed off from inside a
  // WebView/iframe, native has no iframe to be inside), Android gets the
  // same native sheet.
  const { Capacitor } = await import("@capacitor/core");
  const native = Capacitor.isNativePlatform();

  // The traveller has committed to paying — tell Meta (ads) they reached checkout.
  trackMeta("InitiateCheckout", { value: opts.amountPaise / 100, currency: "INR" });

  if (!native) await loadRazorpayCheckout();

  const orderRes = await fetch("/api/razorpay/create-order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount: opts.amountPaise, currency: "INR", receipt: opts.receipt }),
  });
  const order = await orderRes.json();
  if (!orderRes.ok) throw new Error(order.message ?? "Could not start the payment.");

  if (native) {
    const { RazorpayNative } = await import("./razorpay-native");
    const { App } = await import("@capacitor/app");

    trace("native:opening", order.order_id);

    // Razorpay's own checkout screen is a WKWebView. iOS can recycle its
    // content process while this app is backgrounded for the UPI
    // app-switch, and Razorpay's SDK doesn't re-inject its own JS bridge on
    // return — the screen just sits there frozen, and neither
    // onPaymentSuccess nor onPaymentError ever fires. That is a bug in
    // their SDK (see the public issue against their React Native wrapper,
    // which carries the same native iOS checkout underneath), not
    // something fixable from the delegate side here.
    //
    // So this app doesn't wait on that callback once it knows the app has
    // come back from the background: a few seconds after resume, ask the
    // server whether Razorpay actually captured the payment, then dismiss
    // whatever Razorpay left on screen either way — the traveller gets an
    // answer instead of a dead screen, whichever way it went.
    const RESUME_GRACE_MS = 5000;
    let settled = false;
    let abandonSettle: ((result: NativeCheckoutResult) => void) | null = null;
    let abandonFail: ((error: Error) => void) | null = null;
    const abandonedPromise = new Promise<NativeCheckoutResult>((resolve, reject) => {
      abandonSettle = resolve;
      abandonFail = reject;
    });

    let resumeHandled = false;
    const resumeListener = await App.addListener("resume", () => {
      if (settled || resumeHandled) return;
      resumeHandled = true;
      void (async () => {
        await new Promise((r) => setTimeout(r, RESUME_GRACE_MS));
        if (settled) return;
        trace("native:resume-check", order.order_id);
        const recovered = await recoverPayment(order.order_id);
        if (settled) return;
        await RazorpayNative.abandon().catch(() => {});
        if (recovered) {
          trace("native:resume-recovered", order.order_id, recovered);
          abandonSettle?.({ paymentId: recovered });
        } else {
          trace("native:resume-abandoned", order.order_id);
          abandonFail?.(new Error("native:abandoned"));
        }
      })();
    });

    let result: NativeCheckoutResult;
    try {
      // A payment that never comes back is the worst outcome there is: the
      // money has moved, the button still says "Booking…", and nothing
      // reaches the server to say so — so nobody, including us, finds out.
      // The resume race above is the main defence; this timeout is only the
      // backstop for a sheet that never even triggers a resume (e.g. the
      // traveller pays without the app ever leaving the foreground).
      result = await withTimeout(
        Promise.race([
          RazorpayNative.open({
            key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID!,
            optionsJson: JSON.stringify({
              amount: order.amount,
              currency: order.currency,
              order_id: order.order_id,
              name: opts.name ?? "Andaman Go",
              description: opts.description,
              theme: { color: "#13434C" },
            }),
          }).finally(() => {
            settled = true;
          }),
          abandonedPromise,
        ]),
        PAY_TIMEOUT_MS,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // The resume path already asked Razorpay directly and came up empty,
      // and already dismissed the sheet — there is nothing more to check.
      if (message === "native:abandoned") {
        trace("native:abandoned-final", order.order_id);
        throw new Error(
          "We couldn't confirm that payment when you returned to the app. If money left your " +
            `account, quote ${order.order_id} to support — otherwise, try paying again.`,
        );
      }

      trace(message === TIMEOUT ? "native:timeout" : "native:rejected", order.order_id, message);

      // A cancelled sheet is not a lost payment — don't go asking Razorpay
      // about an order nobody paid.
      if (message === "Payment cancelled.") throw error;

      // Everything else might mean the money moved and the callback didn't
      // come back. Ask Razorpay before giving up, because the order id is all
      // it takes to find out, and a booking recovered here is a booking the
      // traveller would otherwise have paid for and not received.
      const recovered = await recoverPayment(order.order_id);
      if (recovered) {
        trace("native:recovered", order.order_id, recovered);
        return {
          orderId: order.order_id,
          paymentId: recovered,
          signature: "",
          amountPaise: order.amount,
        };
      }

      if (message === TIMEOUT) {
        throw new Error(
          "We didn't hear back from the payment screen, and Razorpay has no payment " +
            `against it. Nothing has been booked — quote ${order.order_id} to support if money left your account.`,
        );
      }
      throw error;
    } finally {
      settled = true;
      await resumeListener.remove();
    }

    trace("native:resolved", order.order_id, result.paymentId);

    // The sheet can come back with a bare payment id. Fine: an empty
    // signature sends lib/book.ts down its confirm-with-Razorpay path, which
    // is the stronger check anyway.
    return {
      orderId: result.orderId ?? order.order_id,
      paymentId: result.paymentId,
      signature: result.signature ?? "",
      amountPaise: order.amount,
    };
  }

  return new Promise<PaidReceipt>((resolve, reject) => {
    const razorpay = new window.Razorpay!({
      key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID!,
      amount: order.amount,
      currency: order.currency,
      name: opts.name ?? "Andaman Go",
      description: opts.description,
      order_id: order.order_id,
      handler: (response) => {
        resolve({
          orderId: response.razorpay_order_id,
          paymentId: response.razorpay_payment_id,
          signature: response.razorpay_signature,
          amountPaise: order.amount,
        });
      },
      modal: {
        ondismiss: () => reject(new Error("Payment cancelled.")),
      },
      theme: { color: "#13434C" },
    });

    razorpay.on("payment.failed", (response) => {
      reject(new Error(response.error.description || "Payment failed. Nothing was charged."));
    });

    razorpay.open();
  });
}
