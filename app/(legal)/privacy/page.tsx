import type { Metadata } from "next";
import Link from "next/link";
import { BUSINESS, LAST_UPDATED } from "../legal-meta";
import s from "../legal.module.css";

export const metadata: Metadata = {
  title: "Privacy Policy — Andaman Go",
  description:
    "What Andaman Go collects, why, who else sees it, how long it is kept, and how to ask for a copy or a deletion.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <>
      <p className={s.kicker}>Policies</p>
      <h1 className={s.h1}>Privacy Policy</h1>
      <p className={s.updated}>
        Last updated {LAST_UPDATED.privacy} · {BUSINESS.operator}, trading as{" "}
        {BUSINESS.tradingAs}
      </p>

      <p className={s.summary}>
        The short version: we collect what is needed to get your ticket to you and to let
        the operator recognise you when you arrive. We do not sell your data, we do not run
        advertising trackers, and we never see your card details.
      </p>

      <h2>1. What we collect</h2>

      <h3>Because you gave it to us</h3>
      <ul>
        <li>Email address and phone number, so we can send the ticket and reach you if the operator cancels.</li>
        <li>Your name and party size where a booking needs them — ferry manifests and some activities require passenger details.</li>
        <li>Anything you write to support.</li>
      </ul>

      <h3>Because you used the app</h3>
      <ul>
        <li>Your bookings: what, with whom, when, what you paid, whether the ticket was scanned, and any rating you left afterwards.</li>
        <li>An anonymous session identifier held in a cookie, which is what lets you book before creating an account.</li>
        <li>The island you selected, so the app shows what is near you.</li>
        <li>
          Your device&apos;s location, if you allow it, to tell you whether you&apos;re within
          Andaman &amp; Nicobar. This check happens entirely on your device — the coordinates
          are never sent to us or stored anywhere.
        </li>
        <li>Ordinary technical logs — IP address, browser, timestamps — kept for security and debugging.</li>
      </ul>

      <h3>What we never hold</h3>
      <p>
        Card numbers, UPI IDs and bank credentials. Those go directly to Razorpay. We
        receive only whether a payment succeeded and a reference for it.
      </p>

      <h2>2. Why we hold it</h2>
      <ul>
        <li><strong>To deliver the booking</strong> — issuing the ticket, telling the operator who is coming, letting them scan you in.</li>
        <li><strong>To support you</strong> — answering questions about a specific booking, chasing an operator on your behalf.</li>
        <li><strong>To keep the platform honest</strong> — a rating is tied to a scanned booking, which is only possible because we keep the two connected.</li>
        <li><strong>To meet legal and tax obligations</strong> — transaction records we are required to retain.</li>
        <li><strong>To keep the service secure</strong> — spotting abuse, fraud and misuse.</li>
      </ul>
      <p>
        We do not use your data to build advertising profiles, and we do not send marketing
        you did not ask for.
      </p>

      <h2>3. Who else sees it</h2>
      <ul>
        <li>
          <strong>The operator you booked with</strong> — and only them. They see your name,
          contact details, party size and the ticket for their own booking. They cannot see
          your bookings with anyone else.
        </li>
        <li><strong>Razorpay</strong>, to take the payment and issue refunds.</li>
        <li>
          <strong>The services that run Andaman Go</strong> — Supabase, which hosts our
          database, Vercel, which serves the site, and the service that sends your ticket by
          email. They process your data on our instructions and for no purpose of their own.
        </li>
        <li><strong>Authorities</strong>, where the law requires it — ferry passenger manifests, or a lawful request.</li>
      </ul>
      <p>
        We do not sell personal data, and we do not share it with anyone else for their own
        marketing.
      </p>

      <h2>4. Where it is stored, and for how long</h2>
      <p>
        Your data is held in our Supabase database, hosted <strong>in India</strong> (Mumbai
        region), and the site itself is served by Vercel from its global network. We do not
        transfer your personal data outside India for storage.
      </p>
      <p>
        Booking and payment records are kept for 8 years, because we need them for tax,
        accounting and any dispute. Technical logs are kept for a short period. If you ask
        us to delete your account, we remove your contact details and close it, but we keep
        the minimum transaction record the law requires.
      </p>

      <h2>5. Your choices</h2>
      <ul>
        <li>Ask what we hold about you, and get a copy.</li>
        <li>Correct anything wrong.</li>
        <li>Ask us to delete your account, subject to the records we must keep.</li>
        <li>Withdraw consent for anything you opted into.</li>
      </ul>
      <p>
        Write to <a href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a> from the address
        on the account. We answer within one working day and complete the request within 30
        days.
      </p>

      <h2>6. Cookies and local storage</h2>
      <p>
        We use cookies for one thing: keeping you signed in, including the anonymous session
        that lets you book before you have an account. We use no advertising or cross-site
        tracking cookies. Clearing them signs you out and, if you never attached an email or
        phone number, makes earlier bookings unreachable from that device — your booking
        reference still works.
      </p>

      <h2>7. Children</h2>
      <p>
        Andaman Go is not intended for use by anyone who cannot enter a contract under
        Indian law. We do not knowingly collect data from children. Children travelling as
        part of a booking are included as passenger details supplied by the adult who
        booked.
      </p>

      <h2>8. Changes</h2>
      <p>
        If we change this policy the date at the top changes with it. Material changes will
        be notified to account holders by email.
      </p>

      <h2>9. Grievance officer</h2>
      <p>
        Under the Information Technology (Reasonable Security Practices) Rules, complaints
        about how we handle your data go to {BUSINESS.operator}, at{" "}
        <a href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a> or{" "}
        <a href={`tel:${BUSINESS.phoneHref}`}>{BUSINESS.phone}</a>,{" "}
        {BUSINESS.addressLines.join(", ")}.
      </p>

      <p className={s.tail}>
        See also the <Link href="/terms">Terms &amp; Conditions</Link> and the{" "}
        <Link href="/refunds">Refund &amp; Cancellation Policy</Link>.
      </p>
    </>
  );
}
