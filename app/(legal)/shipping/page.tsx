import type { Metadata } from "next";
import { BUSINESS, LAST_UPDATED } from "../legal-meta";
import s from "../legal.module.css";

// Razorpay's review expects a "shipping" policy. Nothing is shipped, so the
// page answers the question the requirement is really asking: what does the
// customer receive, when, and what happens if it does not arrive.
export const metadata: Metadata = {
  title: "Service Delivery Policy — Andaman Go",
  description:
    "Andaman Go sells bookings for services delivered in person in the Andaman Islands. Your QR ticket is issued immediately; the service is delivered on the date you booked.",
  alternates: { canonical: "/shipping" },
};

const TIMELINE = [
  {
    term: "Booking placed",
    def: "Confirmed on the screen straight away, with a reference code. Nothing is held for review and no operator has to accept it first.",
  },
  {
    term: "QR ticket issued",
    def: "Immediately, in the same moment. It appears in My Bookings in the app and is emailed to the address on the booking. No physical ticket is posted.",
  },
  {
    term: "Operator is notified",
    def: "The booking lands in the operator's partner app against the slot you chose, with the capacity already taken off their availability.",
  },
  {
    term: "Service delivered",
    def: "On the date and at the time you booked, at the operator's location. The operator scans your QR ticket on arrival, and that scan is what records delivery.",
  },
];

const CATEGORIES = [
  ["Activities", "You are checked in at the dive shop or jetty at the booked slot."],
  ["Ferries", "You board the sailing you booked. Carry photo ID; it is required at the jetty."],
  ["Dining", "The table is held for you at the booked time."],
  ["Scooter rentals", "The vehicle is handed over at the shop for the days booked, against a valid driving licence."],
  ["Cabs", "The driver meets you at the agreed pickup point."],
  ["Events & trips", "You are checked in at the start; multi-day trips are delivered across the dates shown on the booking."],
];

export default function ShippingPage() {
  return (
    <>
      <p className={s.kicker}>Policies</p>
      <h1 className={s.h1}>Service Delivery Policy</h1>
      <p className={s.updated}>
        Last updated {LAST_UPDATED.shipping} · {BUSINESS.operator}, trading as{" "}
        {BUSINESS.tradingAs}
      </p>

      <p className={s.summary}>
        <strong>Nothing is shipped.</strong> Andaman Go sells bookings for services
        delivered in person in the Andaman &amp; Nicobar Islands. There are no physical
        goods, no courier, no delivery charge and no tracking number. This page explains
        what you receive instead, and when.
      </p>

      <h2>1. What you receive, and how fast</h2>
      <dl className={s.rules}>
        {TIMELINE.map(({ term, def }) => (
          <div key={term} className={s.rule}>
            <dt className={s.ruleTerm}>{term}</dt>
            <dd className={s.ruleDef}>{def}</dd>
          </div>
        ))}
      </dl>

      <h2>2. Where services are delivered</h2>
      <p>
        In the Andaman &amp; Nicobar Islands only — principally Sri Vijaya Puram (Port
        Blair), Swaraj Dweep (Havelock) and Shaheed Dweep (Neil). Each listing shows the
        island and the operator&apos;s address, and a confirmed booking carries a map link
        to the exact meeting point. We do not deliver anything outside the islands.
      </p>

      <h2>3. What &ldquo;delivered&rdquo; means for each category</h2>
      <ul>
        {CATEGORIES.map(([name, how]) => (
          <li key={name}>
            <strong>{name}</strong> — {how}
          </li>
        ))}
      </ul>

      <h2>4. If the ticket does not arrive</h2>
      <p>
        Check My Bookings in the app first — the ticket lives there whether or not the
        email lands. If it is missing from both, write to{" "}
        <a href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a> or call{" "}
        <a href={`tel:${BUSINESS.phoneHref}`}>{BUSINESS.phone}</a> with your reference code
        and we will reissue it. A missing email never means a missing booking.
      </p>

      <h2>5. If the service is not delivered</h2>
      <p>
        If the operator cancels, does not turn up, or the activity is called off for weather
        or sea conditions, the full amount you paid online is refunded — see the{" "}
        <a href="/refunds">Refund &amp; Cancellation Policy</a>. If you do not turn up, that
        policy&apos;s no-show rules apply instead.
      </p>

      <p className={s.tail}>
        <a href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a> ·{" "}
        <a href={`tel:${BUSINESS.phoneHref}`}>{BUSINESS.phone}</a> ·{" "}
        {BUSINESS.addressLines.join(", ")}. We reply within one working day, IST.
      </p>
    </>
  );
}
