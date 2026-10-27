import type { Metadata } from "next";
import Link from "next/link";
import { BUSINESS } from "../legal-meta";
import s from "../legal.module.css";

export const metadata: Metadata = {
  title: "Contact us — Andaman Go",
  description:
    "Email, phone and registered address for Andaman Go, plus where to write about a booking, listing your business, or a data complaint.",
  alternates: { canonical: "/contact" },
};

export default function ContactPage() {
  return (
    <>
      <p className={s.kicker}>Get in touch</p>
      <h1 className={s.h1}>Contact us</h1>
      <p className={s.updated}>
        A real person on the islands answers these. If it is about a specific booking, send
        the reference code with your first message — it saves a round trip.
      </p>

      {/* Plain text, not an image and not behind a form: this is the block a
          payments reviewer looks for, and a screen reader has to read it too. */}
      <div className={s.contactBlock}>
        <dl className={s.contactRows}>
          <dt>Operated by</dt>
          <dd>
            <span className={s.contactStrong}>{BUSINESS.operator}</span>
            <br />
            Individual proprietor, trading as {BUSINESS.tradingAs}
          </dd>

          <dt>Email</dt>
          <dd className={s.contactStrong}>
            <a href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a>
          </dd>

          <dt>Phone</dt>
          <dd className={s.contactStrong}>
            <a href={`tel:${BUSINESS.phoneHref}`}>{BUSINESS.phone}</a>
          </dd>

          <dt>Registered address</dt>
          <dd>
            <address className={s.address}>
              {BUSINESS.addressLines.map((line, i) => (
                <span key={line}>
                  {i > 0 && <br />}
                  {line}
                </span>
              ))}
            </address>
          </dd>

          <dt>Hours</dt>
          <dd>{BUSINESS.hours}</dd>

          <dt>Response time</dt>
          <dd>Within one working day, IST.</dd>
        </dl>
      </div>

      <h2>Which address to use</h2>

      <h3>A booking, a refund, a ticket that didn&apos;t arrive</h3>
      <p>
        <a href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a> with your reference code.
        For anything time-critical — you are at the jetty and the boat is not — call{" "}
        <a href={`tel:${BUSINESS.phoneHref}`}>{BUSINESS.phone}</a> instead.
      </p>

      <h3>Listing your business</h3>
      <p>
        Register directly at <Link href="/partner">andamango.in/partner</Link>. You can add
        your own listings straight away, and they go live once your licence has been
        reviewed. Questions before you sign up:{" "}
        <a href={`mailto:${BUSINESS.partnerEmail}`}>{BUSINESS.partnerEmail}</a>.
      </p>

      <h3>A complaint about your data</h3>
      <p>
        Our grievance officer is {BUSINESS.operator}, reachable at{" "}
        <a href={`mailto:${BUSINESS.email}`}>{BUSINESS.email}</a> and at the address above.
        See the <Link href="/privacy">Privacy Policy</Link> for what we hold and why.
      </p>

      <h2>Before you write about a booking</h2>
      <p>
        Two things resolve most of it faster than we can. Check My Bookings in the app — the
        QR ticket is there whether or not the email arrived. And if the operator has
        confirmed, their phone number and a map link to the meeting point are on the booking
        itself; for a delayed pickup or a shifted jetty time, calling them directly is
        quicker than going through us.
      </p>
      <p>
        If that does not settle it, we will take it up with the operator ourselves. That is
        what we are for.
      </p>
    </>
  );
}
