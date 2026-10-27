"use client";

// The "pay [commission] now / pay in full" chooser, shared by every booking
// screen whose category allows a deposit (activities, trips, rentals).
// Screens whose category is 'full' or 'free' never render this — they just
// take the price.
//
// It owns nothing: the parent holds `payMode` in state and passes the price
// and that listing's own operator's commissionBps. The split here mirrors
// depositPaise() in lib/payments.ts, which mirrors the database — copies of
// one number, on purpose, so each layer can be read on its own.

import { rupees } from "@/lib/activities";
import { paymentSplit, type PayMode, type PaymentMode } from "@/lib/payments";
import { CheckIcon } from "@/app/icons";
import InAppBrowserNotice from "@/app/in-app-browser-notice";

export default function PayChoice({
  pricePaise,
  mode,
  payMode,
  onChange,
  commissionBps,
  counterLabel = "at the counter",
  nonCommissionablePaise = 0,
}: {
  pricePaise: number;
  mode: PaymentMode;
  payMode: PayMode;
  onChange: (next: PayMode) => void;
  /** That listing's own operator's commission, in basis points — the
   *  deposit is exactly this much of the price (138). */
  commissionBps: number | null;
  /** Who the balance is owed to, e.g. "to Blue Coral Divers on the day". */
  counterLabel?: string;
  /** Part of pricePaise that a deposit never touches — a rental's flat
   *  hotel-delivery fee (064/150), never commissionable and always left
   *  for in person. Zero for every other caller (activities, trips), so
   *  their deposit is unaffected. */
  nonCommissionablePaise?: number;
}) {
  if (mode !== "choice") return <InAppBrowserNotice className="mt-4" />;

  const deposit = paymentSplit(pricePaise - nonCommissionablePaise, "deposit", commissionBps);
  const depositBalance = deposit.balancePaise + nonCommissionablePaise;

  const options: { key: PayMode; title: string; sub: string }[] = [
    {
      key: "deposit",
      title: `Pay ${rupees(deposit.paidNowPaise)} now`,
      sub: `${rupees(depositBalance)} ${counterLabel}`,
    },
    {
      key: "full",
      title: `Pay ${rupees(pricePaise)} now`,
      sub: "Nothing left to pay on the day",
    },
  ];

  return (
    <div className="mt-4 flex flex-col gap-2">
      <InAppBrowserNotice />
      {options.map((opt) => {
        const on = opt.key === payMode;
        return (
          <button
            key={opt.key}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(opt.key)}
            className={`flex items-center gap-3 rounded-2xl border px-3.5 py-3 text-left ${
              on ? "border-brand bg-brandsoft" : "border-line bg-surface"
            }`}
          >
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                on ? "border-brand bg-brand text-white" : "border-line"
              }`}
            >
              {on && <CheckIcon size={13} />}
            </span>
            <span className="min-w-0">
              <span className="block text-[13.5px] font-bold">{opt.title}</span>
              <span className="block text-[11.5px] font-medium text-muted">{opt.sub}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
