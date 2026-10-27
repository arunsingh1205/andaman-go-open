import type { Metadata } from "next";
import Link from "next/link";
import { BUSINESS, LAST_UPDATED } from "../legal-meta";
import s from "../legal.module.css";

export const metadata: Metadata = {
  title: "Terms & Conditions — Andaman Go",
  description:
    "The agreement between you and Andaman Go: what the platform is, how bookings and payments work, what each side is responsible for, and which law applies.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <>
      <p className={s.kicker}>Policies</p>
      <h1 className={s.h1}>Terms &amp; Conditions</h1>
      <p className={s.updated}>
        Last updated {LAST_UPDATED.terms} · {BUSINESS.operator}, trading as{" "}
        {BUSINESS.tradingAs}
      </p>

      <p className={s.summary}>
        By creating an account or making a booking on andamango.in you agree to these terms.
        Read them with the <Link href="/refunds">Refund &amp; Cancellation Policy</Link>, the{" "}
        <Link href="/privacy">Privacy Policy</Link> and the{" "}
        <Link href="/shipping">Service Delivery Policy</Link> — together they are the whole
        agreement between you and us.
      </p>

      <h2>1. Who you are dealing with</h2>
      <p>
        andamango.in is operated by <strong>{BUSINESS.operator}</strong>, an individual
        proprietor trading as {BUSINESS.tradingAs}, of{" "}
        {BUSINESS.addressLines.join(", ")}. In these terms &ldquo;we&rdquo;,
        &ldquo;us&rdquo; and &ldquo;Andaman Go&rdquo; mean that business; &ldquo;you&rdquo;
        means the person making the booking.
      </p>

      <h2>2. What Andaman Go is, and is not</h2>
      <p>
        Andaman Go is a booking platform. The dive, the sailing, the meal, the vehicle and
        the ride are supplied by independent operators who run their own businesses on these
        islands. We take the booking, hold the payment, issue the ticket and record
        delivery. We do not operate boats, drive vehicles, guide dives or cook food.
      </p>
      <p>
        So there are two relationships, and it matters which is which: the contract for the{" "}
        <em>service itself</em> is between you and the operator. Our contract with you is
        for the booking, the payment and the ticket — and for dealing fairly with you when
        something goes wrong.
      </p>

      <h2>3. Your account</h2>
      <p>
        You can browse and book without creating an account; the app gives your browser an
        anonymous identity so a booking has a genuine owner. Creating an account attaches
        your email or phone number to that same identity, so bookings you already made come
        with you.
      </p>
      <ul>
        <li>You are responsible for bookings made from your account or session, and for the accuracy of the contact details you give us — that is where the ticket goes.</li>
        <li>Clearing your browser&apos;s cookies before attaching an email or phone number can leave earlier bookings unreachable from that device. Your booking reference always works; keep it.</li>
        <li>You must be old enough to enter a contract under Indian law to book. Some operators set their own minimum ages for their activities.</li>
      </ul>

      <h2>4. Booking and confirmation</h2>
      <ul>
        <li>You choose the operator and the slot. A booking is never silently moved to a different operator.</li>
        <li>Confirmation is immediate. There is no waiting for an operator to accept — the moment the booking goes through, it is confirmed and your QR ticket and reference code are issued.</li>
        <li>Availability shown is the operator&apos;s own remaining capacity at the moment you look. Two people can reach for the last seat; the booking that completes first gets it.</li>
        <li>An operator can still cancel a confirmed booking afterwards — bad weather, a boat out of service, a vehicle off the road. Where that happens the full amount you paid online is refunded.</li>
      </ul>

      <h2>5. Prices and payment</h2>
      <ul>
        <li>Prices are set by the operator and shown in Indian Rupees. We do not mark up the operator&apos;s price to you; we are paid a commission by the operator on what they sell.</li>
        <li>Depending on the category you may pay the full amount online, or a deposit online with the balance paid to the operator in person — the deposit is that operator&apos;s own agreed service commission, so this is at least Andaman Go&apos;s commission for that specific operator, not a fixed platform-wide figure. For a cab, you pay at least Andaman Go&apos;s service commission for that operator online at checkout and pay the rest of the fare directly to the driver; you can also choose to pay the whole fare online. For a stay or homestay, you pay at least Andaman Go&apos;s service commission for that property online at checkout and pay the rest to the property at check-in; you can also choose to pay the whole stay online, in which case Andaman Go settles the host&apos;s share on a weekly cycle.</li>
        <li>Online payments are processed by <strong>Razorpay</strong>. We do not see or store your card, UPI or bank credentials.</li>
        <li>Anything payable in person — a balance, a security deposit on a rented vehicle, fuel, extras — is between you and the operator.</li>
      </ul>

      <h2>6. Delivering the service, and the scan</h2>
      <p>
        Arrive at the operator&apos;s location at the booked time with your QR ticket or your
        reference code. The operator scans it in their own partner app, and that scan is
        what records the service as delivered. If you do not turn up, the booking is treated
        as a no-show and the{" "}
        <Link href="/refunds">Refund &amp; Cancellation Policy</Link> applies.
      </p>

      <h2>7. Cancellations and refunds</h2>
      <p>
        Set out in full in the{" "}
        <Link href="/refunds">Refund &amp; Cancellation Policy</Link>, which forms part of
        these terms. In short: what you get back depends on whether you paid in full or a
        deposit and how much notice you gave, and when the operator cancels — including for
        weather — you are made whole.
      </p>

      <h2>8. What we ask of you</h2>
      <ul>
        <li>Give correct contact details, and the correct number of people.</li>
        <li>Carry photo ID where the operator or the authorities require it — ferries and vehicle rental in particular.</li>
        <li>Hold a valid driving licence for the class of vehicle before renting a self-drive scooter or bike, and wear a helmet.</li>
        <li>Declare medical conditions that affect a water activity when the operator asks. Diving and sea walks carry inherent risk, and the operator&apos;s safety instructions are not optional.</li>
        <li>Do not book on someone else&apos;s card, resell tickets, or attempt to reuse or forge a QR code.</li>
      </ul>

      <h2>9. Operators on the platform</h2>
      <p>
        Every business on Andaman Go registered itself, supplied a licence document, and had
        that document reviewed by a person here before its listings went live. That is a
        check on who they are, not supervision of how they run each trip. We can suspend a
        business at any time, and when we do its listings stop being bookable immediately.
      </p>

      <h2>10. Reviews</h2>
      <p>
        You can rate an operator only after they have scanned your ticket. We may remove a
        review that is abusive, defamatory, contains personal information about someone
        else, or is not about a service that was actually delivered. We do not edit ratings
        to flatter an operator and we do not sell placement.
      </p>

      <h2>11. Liability</h2>
      <ul>
        <li>The operator is responsible for the service they provide, including its safety, its licensing and its insurance.</li>
        <li>Our liability to you in connection with a booking is limited to the amount you paid through Andaman Go for that booking.</li>
        <li>We are not liable for weather, sea conditions, harbour or administration decisions, ferry rescheduling, road conditions, or anything else outside our reasonable control.</li>
        <li>Nothing here excludes or limits liability that cannot be excluded or limited under Indian law, including for death or personal injury caused by negligence, or for fraud.</li>
      </ul>

      <h2>12. Suspension</h2>
      <p>
        We can suspend or close an account that abuses the platform, files fraudulent
        chargebacks, or puts an operator or another traveller at risk. Where we do, confirmed
        bookings already paid for are honoured or refunded.
      </p>

      <h2>13. Changes to these terms</h2>
      <p>
        We may update these terms. The version in force for a booking is the version
        published when the booking was made, and the date at the top of this page tells you
        when it last changed.
      </p>

      <h2>14. Governing law and jurisdiction</h2>
      <p>
        These terms, and any dispute arising out of them or out of a booking made through
        Andaman Go, are governed by the laws of India.
      </p>
      <p>
        The courts at <strong>Sri Vijaya Puram</strong> (formerly Port Blair), South
        Andaman, have exclusive jurisdiction over any such dispute, and both you and we
        submit to it. The Andaman &amp; Nicobar Islands fall within the territorial
        jurisdiction of the High Court at Calcutta, which sits locally as its Circuit Bench
        at Sri Vijaya Puram.
      </p>
      <p>
        Two things this clause does not do. It does not stop either of us asking any court
        with the power to grant it for urgent interim relief. And it does not take away your
        right, as a consumer under the Consumer Protection Act, 2019, to bring a complaint
        before the consumer commission where you live or work — wherever in India that is.
      </p>

      <h2>15. Contact</h2>
      <p>
        <a href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a> ·{" "}
        <a href={`tel:${BUSINESS.phoneHref}`}>{BUSINESS.phone}</a> ·{" "}
        {BUSINESS.addressLines.join(", ")}. Full details on the{" "}
        <Link href="/contact">contact page</Link>.
      </p>
    </>
  );
}
