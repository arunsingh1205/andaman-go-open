// Shared chrome for the five policy pages.
//
// A route group, so the URLs stay /terms, /privacy, /refunds, /shipping and
// /contact — no /legal prefix for a reviewer to trip over.
//
// Deliberately plain: the real mark, a way back, the document, and a footer
// that links the other four so all five can be walked without going home. No
// sticky nav, no hero, no motion, and no stylesheet shared with the marketing
// page — visual work on / cannot reach these.

import Image from "next/image";
import Link from "next/link";
import { BUSINESS } from "./legal-meta";
import s from "./legal.module.css";

const POLICIES = [
  { href: "/terms", label: "Terms & Conditions" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/refunds", label: "Refund & Cancellation" },
  { href: "/shipping", label: "Service Delivery" },
  { href: "/contact", label: "Contact us" },
];

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={s.page}>
      <header className={s.header}>
        <div className={`${s.wrap} ${s.headerInner}`}>
          <Link href="/" className={s.logoSlot} aria-label="Andaman Go — home">
            <Image
              sizes="150px"
              src="/brand/andaman-go-light-mode.png"
              alt="Andaman Go"
              width={1600}
              height={234}
              priority
              className={s.logo}
            />
          </Link>
          <Link href="/" className={s.back}>
            Back to andamango.in
          </Link>
        </div>
      </header>

      <main className={s.doc}>
        <div className={s.wrap}>{children}</div>
      </main>

      <footer className={s.footer}>
        <div className={s.wrap}>
          <nav className={s.footNav} aria-label="Policies">
            {POLICIES.map(({ href, label }) => (
              <Link key={href} href={href} className={s.footLink}>
                {label}
              </Link>
            ))}
          </nav>
          <p className={s.footMeta}>
            {BUSINESS.tradingAs} · {BUSINESS.addressLines.join(", ")} ·{" "}
            {BUSINESS.email} · {BUSINESS.phone}
          </p>
        </div>
      </footer>
    </div>
  );
}
