import type { Metadata } from "next";
import Link from "next/link";
import { BUSINESS, LAST_UPDATED } from "../legal-meta";
import s from "../legal.module.css";

export const metadata: Metadata = {
  title: "Partner Agreement — Andaman Go",
  description:
    "The agreement between Andaman Go and the operators who list and fulfil bookings on the platform: registration, listings, commission and payouts, service standards, liability and how the agreement ends.",
  alternates: { canonical: "/partner-agreement" },
};

export default function PartnerAgreementPage() {
  return (
    <>
      <p className={s.kicker}>For operators</p>
      <h1 className={s.h1}>Partner Agreement</h1>
      <p className={s.updated}>
        Last updated {LAST_UPDATED.partnerAgreement} · {BUSINESS.operator}, trading as{" "}
        {BUSINESS.tradingAs}
      </p>

      <p className={s.summary}>
        This is the agreement you accept when you register a business on andamango.in. It sits
        alongside the <Link href="/terms">Terms &amp; Conditions</Link>, the{" "}
        <Link href="/refunds">Refund &amp; Cancellation Policy</Link>, the{" "}
        <Link href="/privacy">Privacy Policy</Link> and the{" "}
        <Link href="/shipping">Service Delivery Policy</Link> — together they are the whole
        agreement between your business and Andaman Go. If any of those conflict with this
        page on a question about operators, this page wins.
      </p>

      <h2>1. Who this is between</h2>
      <p>
        This agreement is between <strong>{BUSINESS.operator}</strong>, an individual
        proprietor trading as {BUSINESS.tradingAs}, of {BUSINESS.addressLines.join(", ")}{" "}
        (&ldquo;Andaman Go&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;), and the business you
        register on the platform (&ldquo;you&rdquo;, &ldquo;the operator&rdquo;). By ticking
        the box on the registration screen you confirm that you have read this agreement, that
        you accept it on behalf of that business, and that you are authorised to do so.
      </p>

      <h2>2. What Andaman Go is</h2>
      <p>
        Andaman Go is a booking marketplace. Travellers find your listings, book a slot and
        pay through the platform; we hold the payment, issue the ticket, record delivery when
        you scan it, and pass on your share. The dive, the sailing, the meal, the vehicle and
        the ride are yours — supplied by you, under your own licences, with your own staff and
        equipment.
      </p>
      <p>
        So the contract for the service itself is between you and the traveller. Our contract
        with you is for listing, booking, payment collection and the ticket. This agreement
        does not make either of us the other&apos;s agent, partner, employer or joint
        venturer, and neither side may hold the other out as such.
      </p>

      <h2>3. Registering your business</h2>
      <ul>
        <li>Register only a business you own or are authorised to represent, once. Give correct legal and contact details and keep them current in your dashboard.</li>
        <li>Upload a genuine, valid licence or registration document for the activity you offer. We review who you are before your listings go live; that is an identity check, not supervision of how you run each trip.</li>
        <li>You must be able to enter a contract under Indian law, and hold every registration, permit and clearance the authorities require for your category — ferry, water sports, vehicle hire, food service and events each have their own.</li>
        <li>Your account, and the Google sign-in behind it, are yours to protect. You are responsible for everything done through it, including by your team members you invite.</li>
      </ul>

      <h2>4. Review, approval and listing</h2>
      <p>
        A newly registered business starts as <em>pending</em>. You can build listings
        straight away, but nothing is bookable until we approve the business and the listing.
        We may decline or ask for changes, and we do not have to give a reason beyond what is
        useful to you. Approval is not an endorsement and does not transfer any of your legal
        responsibilities to us.
      </p>

      <h2>5. Your listings and content</h2>
      <ul>
        <li>You own your listing text, photos and prices, and you are responsible for their accuracy — what is included, what is not, timings, capacity, restrictions and safety information.</li>
        <li>You grant Andaman Go a non-exclusive, royalty-free licence to host, display, resize and promote that content — on the platform, in search results and in marketing for your listings — for as long as the listing is live and for a reasonable period afterwards for records and cached pages.</li>
        <li>You confirm you have the right to everything you upload, including photographs, and that it is not misleading, unlawful or infringing.</li>
        <li>We may correct formatting, shorten, or remove content that is inaccurate, unsafe, unlawful or against these policies. We do not rewrite your prices.</li>
      </ul>

      <h2>6. Prices, availability and honouring bookings</h2>
      <ul>
        <li>You set your own prices in Indian Rupees. We do not mark them up to the traveller. The price a traveller sees and accepts is the price you have agreed to honour for that booking.</li>
        <li>Keep your availability, timetables and capacity accurate. The seats shown are your own remaining capacity at that moment.</li>
        <li>Every booking is confirmed immediately, with no accept step. You must honour every confirmed booking at the price and scope shown, or cancel it through the platform and let the refund rules apply.</li>
        <li>Do not use platform bookings or traveller contact details to move a customer off Andaman Go for the same or a substitute service, or to take payment outside the platform for a platform booking.</li>
        <li>Deliver the service at the booked time and scan the traveller&apos;s QR ticket or reference code in your partner app. That scan is what records the service as delivered and releases your payout.</li>
      </ul>

      <h2>7. Commission and payouts</h2>
      <ul>
        <li>Andaman Go is paid a commission on what you sell through the platform. The rate is the one agreed for your business and shown in your dashboard, and forms part of this agreement; we may change it on reasonable notice, and the rate in force when a booking is made is the rate for that booking.</li>
        <li>Where a traveller may pay a deposit rather than the full amount, that deposit is exactly your own agreed commission rate — not a fixed platform-wide figure. It is collected online at checkout and is Andaman Go&apos;s in full; the balance is settled with you directly, in person.</li>
        <li>For cab services the commission is collected online at checkout: the traveller pays at least your agreed rate to Andaman Go when booking, and pays the rest of the fare to you (the driver) directly, in person. A traveller may also choose to pay the whole fare online, in which case we remit your share as in the next clause.</li>
        <li>For stays and homestays, at checkout the traveller either pays at least your agreed rate to Andaman Go and pays the rest to you (the property) directly at check-in, or pays the whole stay online. Where the whole stay is paid online, we hold your share and settle it to your payout account on a weekly cycle, with the batch and its status shown in your dashboard.</li>
        <li>We collect the traveller&apos;s payment, deduct our commission and any payment-processing fees, and remit the balance to the payout account you register. Anything the traveller pays you in person — a balance, a security deposit, fuel, extras — is yours to collect directly and is not part of this settlement.</li>
        <li>Payouts are made after the service is delivered and scanned, on the schedule shown in your dashboard, subject to a valid payout account and any statutory holding period. Bookings still within their cancellation window, in dispute, or flagged for review may be held until resolved. A stay&apos;s weekly settlement instead becomes due once the stay&apos;s check-out date has passed and the booking wasn&apos;t cancelled first.</li>
        <li>Where a traveller is refunded — including for your cancellation, a no-show under the policy, or a chargeback — we may deduct the corresponding amount and any fees from that payout or a later one, or invoice you for it.</li>
        <li>We will make our commission statements available to you. You are responsible for your own record-keeping and tax on your earnings.</li>
      </ul>

      <h2>8. Cancellations, weather and no-shows</h2>
      <p>
        The <Link href="/refunds">Refund &amp; Cancellation Policy</Link> governs what a
        traveller gets back, and it forms part of this agreement. In short: if you cancel a
        confirmed booking, the traveller is refunded in full for what they paid online and
        you bear that cost; genuine weather and safety cancellations are handled the same way
        for the traveller; a no-show is assessed under the policy. Repeated avoidable
        cancellations are grounds for suspension.
      </p>

      <h2>9. Service standards and safety</h2>
      <ul>
        <li>You are solely responsible for the service you provide, including its safety, the condition of your vessels, vehicles and equipment, the competence of your staff and guides, and compliance with every applicable law and authority instruction.</li>
        <li>Hold the insurance appropriate to your activity, including public liability where relevant, and produce evidence of it on request.</li>
        <li>Follow your own stated safety procedures and age, health and licence requirements, and apply them consistently to platform travellers.</li>
        <li>Tell us promptly about any serious incident, injury, authority action, licence lapse or insurance lapse that affects your ability to deliver bookings.</li>
      </ul>

      <h2>10. Traveller information</h2>
      <p>
        We share only the traveller details you need to deliver a booking. You may use them
        for that booking and nothing else — no marketing, no adding them to a list, no
        passing them on. Handle them in line with the{" "}
        <Link href="/privacy">Privacy Policy</Link> and applicable data-protection law,
        keep them secure, and delete them when you no longer need them for the booking or
        your legal records. You are the controller of any traveller data you keep in your
        own systems.
      </p>

      <h2>11. Reviews</h2>
      <p>
        Travellers can rate you only after you have scanned their ticket. We do not edit
        ratings to flatter an operator and we do not sell placement. We may remove a review
        that is abusive, defamatory, contains someone else&apos;s personal information, or is
        not about a service that was actually delivered — on our own initiative or at your
        request, using the same standard either way.
      </p>

      <h2>12. Taxes</h2>
      <p>
        You are responsible for determining, charging where required, collecting and
        remitting all taxes on the services you sell, including GST. Andaman Go is
        responsible for tax on its own commission. Prices you enter are treated as inclusive
        of any tax you must charge the traveller unless your dashboard says otherwise.
      </p>

      <h2>13. Brand and intellectual property</h2>
      <p>
        Each side keeps its own names, logos and material. We grant you a limited,
        revocable licence to state that your business is available on Andaman Go, using our
        current brand assets as provided and not altered. You grant us the licence in
        clause 5 to show and promote your listings. Neither side gets any other right to the
        other&apos;s intellectual property.
      </p>

      <h2>14. Confidentiality</h2>
      <p>
        Non-public information one side gives the other for this relationship — commercial
        terms, platform data, traveller data — is confidential, to be used only for this
        agreement and not disclosed except where the law requires it or to advisers under
        the same duty.
      </p>

      <h2>15. Suspension and ending this agreement</h2>
      <ul>
        <li>Either side may end this agreement at any time on reasonable notice. We may suspend or remove a business or a listing immediately where there is a safety risk, suspected fraud, a licence or insurance lapse, a legal requirement, or a serious or repeated breach of these policies.</li>
        <li>When the agreement ends or a business is suspended, its listings stop being bookable. Confirmed bookings already taken are either honoured by you or cancelled and refunded to the traveller.</li>
        <li>Your final payout is made once all delivered bookings are settled and any refunds, chargebacks and amounts you owe are accounted for.</li>
        <li>Clauses that by their nature should survive — payment reconciliation, confidentiality, data, liability, indemnity and governing law — continue after the agreement ends.</li>
      </ul>

      <h2>16. Liability and indemnity</h2>
      <ul>
        <li>You indemnify Andaman Go against claims, losses, fines and reasonable costs arising from the service you provide, from your content, or from your breach of this agreement or of any law — including claims by travellers, your staff, authorities or third parties.</li>
        <li>Our total liability to you in connection with this agreement in any 12-month period is limited to the commission we earned on your bookings in the three months before the claim, or the amount we are holding for you at that time, whichever is greater.</li>
        <li>Neither side is liable to the other for indirect or consequential loss, or for loss of profit, goodwill or business, however caused.</li>
        <li>We are not liable for weather, sea conditions, harbour or administration decisions, ferry rescheduling, road conditions, payment-provider outages, or anything else outside our reasonable control.</li>
        <li>Nothing here excludes or limits liability that cannot be excluded or limited under Indian law, including for death or personal injury caused by negligence, or for fraud.</li>
      </ul>

      <h2>17. Changes to this agreement</h2>
      <p>
        We may update this agreement. The date at the top tells you when it last changed,
        and it carries a version. We will tell you about material changes through the
        partner app or by email; continuing to take bookings after a change takes effect
        means you accept the new version. Where a change materially reduces your rights we
        may ask you to re-accept it before you can keep selling.
      </p>

      <h2>18. Governing law and jurisdiction</h2>
      <p>
        This agreement, and any dispute arising out of it or out of a booking made through
        Andaman Go, are governed by the laws of India.
      </p>
      <p>
        The courts at <strong>Sri Vijaya Puram</strong> (formerly Port Blair), South
        Andaman, have exclusive jurisdiction, and both sides submit to it. The Andaman &amp;
        Nicobar Islands fall within the territorial jurisdiction of the High Court at
        Calcutta, which sits locally as its Circuit Bench at Sri Vijaya Puram. This clause
        does not stop either side asking any competent court for urgent interim relief, and
        it does not take away a right you have as a consumer under the Consumer Protection
        Act, 2019.
      </p>

      <h2>19. Contact</h2>
      <p>
        <a href={`mailto:${BUSINESS.partnerEmail}`}>{BUSINESS.partnerEmail}</a> ·{" "}
        <a href={`tel:${BUSINESS.phoneHref}`}>{BUSINESS.phone}</a> ·{" "}
        {BUSINESS.addressLines.join(", ")}. General details on the{" "}
        <Link href="/contact">contact page</Link>.
      </p>
    </>
  );
}
