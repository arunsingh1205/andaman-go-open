"use client";

// A "Pay" button that opens Razorpay's own hosted checkout modal.
//
// Standard Checkout is three hops: this button asks our server for an order,
// hands that order id to Razorpay's script so the modal itself never sees our
// key secret, then on success sends the receipt back to our server to be
// re-verified. If step three doesn't come back ok, nothing here should be
// treated as paid — the modal closing "successfully" is not proof by itself.

import { useEffect, useRef, useState } from "react";
import { loadRazorpayCheckout } from "@/lib/razorpay-client";

export default function RazorpayCheckoutButton({
  amountPaise,
  receipt,
  name = "Andaman Go",
  description,
  label,
  className,
  onSuccess,
  onError,
}: {
  /** The whole amount to charge, in paise — minimum 100 (₹1). */
  amountPaise: number;
  /** Your own reference for this order, max 40 chars. */
  receipt?: string;
  name?: string;
  description?: string;
  label?: string;
  className?: string;
  /** Called once the payment is verified server-side. */
  onSuccess: (paymentId: string) => void;
  /** Called on cancellation, a failed payment, or a verification mismatch. */
  onError?: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  // Guards against the handler firing after the component has unmounted —
  // Razorpay's modal outlives a React re-render if the user navigates away.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const pay = async () => {
    if (busy) return;
    setBusy(true);

    try {
      await loadRazorpayCheckout();

      const orderRes = await fetch("/api/razorpay/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: amountPaise,
          currency: "INR",
          receipt: receipt ?? `order-${Date.now()}`,
        }),
      });
      const order = await orderRes.json();
      if (!orderRes.ok) throw new Error(order.message ?? "Could not start the payment.");

      const razorpay = new window.Razorpay!({
        key: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID!,
        amount: order.amount,
        currency: order.currency,
        name,
        description,
        order_id: order.order_id,
        handler: async (response) => {
          try {
            const verifyRes = await fetch("/api/razorpay/verify-payment", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(response),
            });
            const result = await verifyRes.json();
            if (!mounted.current) return;
            if (verifyRes.ok && result.ok) {
              onSuccess(response.razorpay_payment_id);
            } else {
              onError?.(result.message ?? "Payment could not be verified.");
            }
          } finally {
            if (mounted.current) setBusy(false);
          }
        },
        modal: {
          ondismiss: () => {
            if (!mounted.current) return;
            setBusy(false);
            onError?.("Payment cancelled.");
          },
        },
        theme: { color: "#13434C" },
      });

      razorpay.on("payment.failed", (response) => {
        if (!mounted.current) return;
        setBusy(false);
        onError?.(response.error.description || "Payment failed.");
      });

      razorpay.open();
    } catch (error) {
      setBusy(false);
      onError?.(error instanceof Error ? error.message : "Something went wrong.");
    }
  };

  return (
    <button
      type="button"
      disabled={busy}
      onClick={pay}
      className={
        className ??
        "flex h-13 w-full items-center justify-center rounded-2xl bg-brand text-[15px] font-bold text-white disabled:opacity-60"
      }
    >
      {busy ? "Opening…" : (label ?? "Pay now")}
    </button>
  );
}
