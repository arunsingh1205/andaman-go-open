import type { Metadata } from "next";
import { BUSINESS, LAST_UPDATED } from "../legal-meta";
import s from "../legal.module.css";

export const metadata: Metadata = {
  title: "Refund & Cancellation Policy — Andaman Go",
  description:
    "What happens to your money when a booking does not go ahead: cancellation windows by category, who bears the cost, and how weather cancellations are treated.",
  alternates: { canonical: "/refunds" },
};

// The rules below are not marketing copy — they are what cancel_my_booking_item
// and migrations 036/050 actually enforce. If the rule changes in the database,
// it changes here on the same day.
const TRAVELLER_RULES = [
  {
    term: "Paid in full, more than 24 hours before the start",
    def: "50% of the amount paid online is refunded.",
  },
  {
    term: "Paid in full, within 24 hours of the start",
    def: "No refund. The operator has held capacity that can no longer be resold.",
    caution: true,
  },
  {
    term: "Paid a deposit",
    def: "The deposit is not refunded, at any notice — it's the service commission collected at checkout, which you chose to pay upfront to hold the booking, settling the balance in person.",
  },
  {
    term: "Cabs",
    def: "The amount you paid Andaman Go online — the service commission collected at checkout, or more — is not refunded, at any notice. Anything still owed to the driver is simply not collected. If you paid the whole fare online, the paid-in-full rules above apply to it.",
  },
  {
    term: "Stays & homestays",
    def: "The amount you paid Andaman Go online — the service commission collected at checkout, or more — is not refunded, at any notice. Anything still owed to the property is simply not collected. If you paid the whole stay online, the paid-in-full rules above apply to it.",
  },
];

export default function RefundsPage() {
  return (
    <>
      <p className={s.kicker}>Policies</p>
      <h1 className={s.h1}>Refund &amp; Cancellation Policy</h1>
      <p className={s.updated}>
        Last updated {LAST_UPDATED.refunds} · {BUSINESS.operator}, trading as{" "}
        {BUSINESS.tradingAs}
      </p>

      <p className={s.summary}>
        Andaman Go is a booking platform. The activity, sailing, meal, vehicle or ride is
        supplied by an independent operator; we take the booking, hold the payment and
        issue the ticket. This page sets out what happens to your money when a booking
        does not go ahead.
      </p>

      <h2>1. When you cancel</h2>
      <p>
        You can cancel a booking yourself from My Bookings. What comes back depends on how
        you paid and how much notice you give.
      </p>

      <dl className={s.rules}>
        {TRAVELLER_RULES.map(({ term, def, caution }) => (
          <div key={term} className={`${s.rule} ${caution ? s.caution : ""}`}>
            <dt className={s.ruleTerm}>{term}</dt>
            <dd className={s.ruleDef}>{def}</dd>
          </div>
        ))}
      </dl>

      <h2>2. When the operator cancels</h2>
      <p>
        You are made whole. The entire amount paid online is refunded, whatever the notice
        and whether you paid a deposit or in full. The same applies when Andaman Go cancels
        a booking on an operator&apos;s behalf — for example when an operator has become
        unreachable.
      </p>

      <h2>3. Weather</h2>
      <div className={s.note}>
        <p>
          Water activities and ferry sailings are called off by the operator or by the
          harbour authority, not by you and not by us. A weather cancellation is treated as
          an operator cancellation: a full refund of what you paid online. If you decide not
          to go on a day the operator is still sailing, section 1 applies instead.
        </p>
      </div>

      <h2>4. How refunds reach you</h2>
      <p>
        To the original payment method, through <strong>Razorpay</strong>, within 5 to 7
        business days of approval. We do not refund to a different account, and we do not
        refund in cash.
      </p>

      <h2>5. No-shows</h2>
      <p>
        If you do not arrive and did not cancel, the booking is treated as a no-show and
        section 1&apos;s inside-24-hours rule applies. If you are running late, message the
        operator from the booking — most will hold a place if they know.
      </p>

      <h2>6. Disputes</h2>
      <p>
        If you think a refund has been calculated wrongly, write to us with your booking
        reference before raising a chargeback. We would rather fix it directly, and we can
        usually do it the same day.
      </p>

      <p className={s.tail}>
        Questions about a specific booking:{" "}
        <a href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a> or{" "}
        <a href={`tel:${BUSINESS.phoneHref}`}>{BUSINESS.phone}</a>, quoting your booking
        reference. {BUSINESS.hours}.
      </p>
    </>
  );
}
