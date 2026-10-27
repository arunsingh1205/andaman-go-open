"use client";

// On the booking-confirmed screen: tells Meta a booking really happened. The
// screen only has a `ref` once the database has issued one, so this never
// fires for a half-finished booking. Once per reference per browser, so
// reopening the confirmation later doesn't count it twice. Money paid online
// is the value (a deposit booking reports the deposit, not the full price).
// A booking with nothing paid online — a free RSVP — is a Lead, not a sale.

import { useEffect } from "react";
import { trackMeta } from "@/lib/meta-events";

export default function PurchaseBeacon({
  bookingRef,
  kind,
  paidPaise,
}: {
  bookingRef: string;
  kind: string;
  paidPaise: number;
}) {
  useEffect(() => {
    const key = `purchased:${bookingRef}`;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, "1");
    } catch {
      // storage blocked — fire anyway
    }
    const params = { content_type: kind, content_ids: [bookingRef] };
    if (paidPaise > 0) {
      trackMeta("Purchase", { ...params, value: paidPaise / 100, currency: "INR" }, bookingRef);
    } else {
      trackMeta("Lead", params, bookingRef);
    }
  }, [bookingRef, kind, paidPaise]);

  return null;
}
