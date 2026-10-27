import type { Metadata } from "next";
import PageBack from "@/app/page-back";
import BottomNav from "@/app/bottom-nav";
import { TagIcon } from "@/app/icons";
import { getPublicOffers, resolveScopeLabels, offerDiscountLabel } from "@/lib/offers";
import { rupees } from "@/lib/activities";
import CopyCodeButton from "./copy-code-button";

// The "what offers do we have right now" browse page (160) — a traveller
// doesn't need a code in hand already, unlike the Apply field on a booking
// panel (158). Only shows codes an admin flagged is_public — a one-off
// code arranged for a specific operator/customer stays off this page even
// while it's still active and usable if someone has it directly.

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Offers & promo codes — Andaman Go",
  description:
    "Current discount codes on Andaman Go — activities, trips and island adventures. Apply one at checkout.",
  alternates: { canonical: "/offers" },
};

export default async function OffersPage() {
  const offers = await getPublicOffers();
  const labels = await resolveScopeLabels(offers.flatMap((o) => o.scopes));

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-hairline bg-surface">
        <div className="page-well pt-[calc(var(--safe-top)+1.5rem)] pb-3.5 lg:pt-10 lg:pb-6">
          <div className="flex items-center gap-3">
            <PageBack href="/explore" />
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-[19px] lg:text-page font-bold tracking-tight">
                Offers
              </h1>
              <p className="text-[12px] font-medium text-muted">
                {offers.length > 0
                  ? `${offers.length} running right now`
                  : "Nothing running right now"}
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="page-well pt-4 pb-32 lg:pt-8 lg:pb-24">
        {offers.length === 0 ? (
          <p className="mt-10 text-center text-[13.5px] text-muted">
            Check back soon — we&apos;ll post new offers here as they go live.
          </p>
        ) : (
          <ul className="flex flex-col gap-3 lg:grid lg:grid-cols-2 lg:gap-4">
            {offers.map((o) => {
              const scopeText =
                o.scopes.length === 0
                  ? "Valid on any activity or island adventure"
                  : `Valid on ${o.scopes
                      .map((s) => labels.get(`${s.kind}:${s.slug}`) ?? s.slug)
                      .join(", ")}`;

              return (
                <li
                  key={o.code}
                  className="rounded-panel border border-line bg-surface p-4 lg:p-5"
                >
                  <div className="flex items-start gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brandsoft text-brand">
                      <TagIcon size={20} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[16px] font-bold text-brand">{offerDiscountLabel(o)}</p>
                      <p className="mt-0.5 text-[13px] leading-snug font-semibold text-ink">
                        {o.headline ?? scopeText}
                      </p>
                      {o.headline && (
                        <p className="mt-1 text-[12px] font-medium text-muted">{scopeText}</p>
                      )}
                      {o.minOrderPaise > 0 && (
                        <p className="mt-1 text-[11.5px] font-medium text-muted">
                          On orders of {rupees(o.minOrderPaise)} or more
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="mt-3.5 flex items-center justify-between gap-2 rounded-xl border border-dashed border-line bg-ground px-3.5 py-2.5">
                    <span className="font-mono text-[14px] font-bold tracking-wide">{o.code}</span>
                    <CopyCodeButton code={o.code} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <p className="mt-6 text-center text-[11.5px] font-medium text-muted">
          Apply a code at checkout on an activity or island adventure booking. If it&apos;s not
          available for what you picked, you&apos;ll see why before you pay.
        </p>
      </main>

      <BottomNav />
    </>
  );
}
