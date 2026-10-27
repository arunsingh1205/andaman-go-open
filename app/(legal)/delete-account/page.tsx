import type { Metadata } from "next";
import DeleteAccountRequest from "@/app/delete-account-request";
import { BUSINESS, LAST_UPDATED } from "../legal-meta";
import s from "../legal.module.css";

export const metadata: Metadata = {
  title: "Delete Your Account — Andaman Go",
  description: "How to request deletion of your Andaman Go or Andaman Go Partner account and data.",
  alternates: { canonical: "/delete-account" },
};

// Required by Google Play's account-deletion policy for any app that lets
// someone create an account — linked from the Partner app's Play Console
// Data Safety form. Covers both a traveller account and a partner account,
// since both sign in against the same auth.users table.
//
// Apple asks for more than Google does: Review Guideline 5.1.1(v) requires
// deletion to be startable from INSIDE the app, so "email us" alone is a
// rejection on iOS. <DeleteAccountRequest /> below is that in-app path — the
// traveller app links here from Profile, and partner Settings renders the
// same component inline so the partner dashboard keeps the flow in /partner.
export default function DeleteAccountPage() {
  return (
    <>
      <p className={s.kicker}>Account</p>
      <h1 className={s.h1}>Delete Your Account</h1>
      <p className={s.updated}>Last updated {LAST_UPDATED.terms}</p>

      <p className={s.summary}>
        You can ask us to delete your Andaman Go account — traveller or partner — and the
        personal data tied to it, at any time.
      </p>

      <h2>How to request deletion</h2>
      <p>
        If you&apos;re signed in, request it right here — no email needed:
      </p>
      <DeleteAccountRequest account="traveller" />
      <p>
        Or email <a href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a> (partners can also use{" "}
        <a href={`mailto:${BUSINESS.partnerEmail}`}>{BUSINESS.partnerEmail}</a>) from the email
        address on your account, with the subject line <strong>&ldquo;Delete my account&rdquo;</strong>.
        Tell us whether it&apos;s a traveller or partner account.
      </p>

      <h2>What gets deleted</h2>
      <p>
        Your profile, contact details, saved payment methods, and any photos or documents you
        uploaded. For a partner account, this includes business details, listings, and payout
        information on file.
      </p>

      <h2>What we keep, and why</h2>
      <p>
        Booking and payment records tied to completed transactions are kept for the period
        required by Indian tax and accounting law, even after account deletion — this is
        financial record-keeping, not active use of your account. They are not used for
        anything beyond that legal retention requirement.
      </p>

      <h2>How long it takes</h2>
      <p>We confirm the request and complete deletion within 30 days.</p>

      <p className={s.tail}>
        Questions: <a href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a> or{" "}
        <a href={`tel:${BUSINESS.phoneHref}`}>{BUSINESS.phone}</a>. {BUSINESS.hours}.
      </p>
    </>
  );
}
