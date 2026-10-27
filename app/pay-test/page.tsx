"use client";

// A bare page for exercising the Razorpay integration end to end, independent
// of any real booking. Nothing here writes to the database — it only proves
// create-order → checkout modal → verify-payment works before that flow gets
// wired into an actual booking screen.
//
// RAZORPAY_KEY_ID/SECRET are live as of 2026-09-07 — this charges a real
// card for real money. Kept at Razorpay's ₹1 minimum on purpose.

import { useState } from "react";
import RazorpayCheckoutButton from "@/app/razorpay-checkout-button";
import { rupees } from "@/lib/activities";

const AMOUNT_PAISE = 100; // ₹1 — Razorpay's minimum, and real money.

export default function PayTestPage() {
  const [result, setResult] = useState<string | null>(null);

  return (
    <main className="mx-auto flex max-w-[430px] flex-col items-center px-5 pt-24 pb-16 text-center">
      <h1 className="font-display text-[19px] font-bold tracking-tight">Razorpay live payment</h1>
      <p className="mt-2 text-[13.5px] leading-relaxed font-bold text-warn">
        This is LIVE — it charges a real card {rupees(AMOUNT_PAISE)}, refundable from the
        Razorpay dashboard.
      </p>

      <div className="mt-6 w-full">
        <RazorpayCheckoutButton
          amountPaise={AMOUNT_PAISE}
          description="Test payment"
          onSuccess={(paymentId) => setResult(`Verified — payment ${paymentId}`)}
          onError={(message) => setResult(`Not paid: ${message}`)}
        />
      </div>

      {result && <p className="mt-4 text-[13px] font-semibold">{result}</p>}
    </main>
  );
}
