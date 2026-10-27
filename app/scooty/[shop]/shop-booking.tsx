"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { bookNow } from "@/lib/book";
import { depositPaise, type PayMode } from "@/lib/payments";
import { ensureSession } from "@/lib/supabase-browser";
import { chargeViaRazorpay, makeReceipt, MIN_CHARGE_PAISE } from "@/lib/razorpay-client";
import { rupees } from "@/lib/activities";
import {
  addDays,
  BOOKING_CUTOFF_HOURS,
  dayKey,
  fmtClock,
  fmtDateLabel,
  fmtDayLabel,
  fmtDayNum,
  fmtMonth,
  instantIso,
  isPastCutoff,
  todayIST,
} from "@/lib/date";
import {
  DELIVERY_PAISE,
  MAX_DAYS,
  PICKUP_WINDOW_DAYS,
  rentalPickupOptions,
  TYPE_LABEL,
  type Shop,
  type VehicleType,
} from "@/lib/rentals";
import ExpandableText from "@/app/expandable-text";
import PayChoice from "@/app/pay-choice";
import {
  BicycleIcon,
  BikeIcon,
  CheckIcon,
  ChevronIcon,
  LicenceIcon,
  ScooterIcon,
} from "@/app/icons";

const TYPE_ICON = {
  scooter: ScooterIcon,
  bike: BikeIcon,
  bicycle: BicycleIcon,
};

/** The pick-up times still on offer for one date — the shop's hours for
 *  that weekday (035), minus whatever's inside the 2-hour booking cutoff.
 *  Pure and cheap enough to call on every render for a ~30-entry date strip;
 *  the same shape pickupWindow() (lib/rentals.ts) computes server-side for
 *  the initial today-or-tomorrow default. */
function optionsFor(hours: Shop["hours"], dateKey: string): { mins: number; label: string }[] {
  const dow = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  return rentalPickupOptions(hours, dow).filter(
    (o) => !isPastCutoff(instantIso(dateKey, o.mins), BOOKING_CUTOFF_HOURS),
  );
}

/** How many of one vehicle are actually free for the selected (date, days) —
 *  the peak out-count across every day of the stay, same window
 *  create_booking's own 'rental' branch checks at booking time (151), not
 *  just whatever was out on the day the page happened to load. */
function availableFor(shop: Shop, vehicleId: string, pickupDateKey: string, days: number): number {
  const vehicle = shop.vehicles.find((v) => v.id === vehicleId);
  if (!vehicle) return 0;

  const loadByDate = shop.loadByVehicleDate[vehicleId] ?? {};
  const start = new Date(`${pickupDateKey}T00:00:00Z`);
  let peak = 0;
  for (let n = 0; n < days; n++) {
    const load = loadByDate[dayKey(addDays(start, n))] ?? 0;
    if (load > peak) peak = load;
  }
  return Math.max(0, vehicle.stock - peak);
}

export default function ShopBooking({
  shop,
  pickupDateKey: initialPickupDateKey,
  pickupOptions: initialPickupOptions,
}: {
  shop: Shop;
  /** Today-or-tomorrow, whichever pickupWindow() (lib/rentals.ts) landed on
   *  server-side — just the form's starting point; the date strip below
   *  lets the traveller move it anywhere in PICKUP_WINDOW_DAYS. */
  pickupDateKey: string;
  pickupOptions: { mins: number; label: string }[];
}) {
  const router = useRouter();
  const [days, setDays] = useState(3);
  const [pick, setPick] = useState(
    (shop.vehicles.find((v) => v.available > 0) ?? shop.vehicles[0]).id,
  );
  const [pickupDateKey, setPickupDateKey] = useState(initialPickupDateKey);
  const [pickupMins, setPickupMins] = useState(initialPickupOptions[0]?.mins ?? 9 * 60);
  const [payMode, setPayMode] = useState<PayMode>("deposit");
  const [deliver, setDeliver] = useState(false);
  const [hotelName, setHotelName] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const today = todayIST();
  const dateChips = Array.from({ length: PICKUP_WINDOW_DAYS }, (_, i) => {
    const d = addDays(today, i);
    const key = dayKey(d);
    return { key, label: fmtDayLabel(d), num: fmtDayNum(d), month: fmtMonth(d) };
  });
  const pickupOptions = optionsFor(shop.hours, pickupDateKey);

  const selectDate = (key: string) => {
    const opts = optionsFor(shop.hours, key);
    if (opts.length === 0) return;
    setPickupDateKey(key);
    setPickupMins(opts[0].mins);
    setProblem(null);
  };

  const pickupDate = new Date(`${pickupDateKey}T00:00:00Z`);
  const pickupLabel = `${fmtDateLabel(pickupDate)}, ${fmtClock(pickupMins)}`;
  const returnLabel = `${fmtDateLabel(addDays(pickupDate, days))}, ${fmtClock(pickupMins)}`;

  const chosen = shop.vehicles.find((v) => v.id === pick)!;
  const soldOut = availableFor(shop, chosen.id, pickupDateKey, days) <= 0;
  const base = chosen.ratePaise * days;
  const total = base + (deliver ? DELIVERY_PAISE : 0);
  const dayWord = days === 1 ? "day" : "days";

  const effectiveMode: PayMode = shop.paymentMode === "choice" ? payMode : "full";
  // Hotel delivery is never commissionable (064/150) — a deposit is the
  // shop's own commission rate, so it's computed on `base` alone and the
  // delivery fee lands entirely in balancePaise, never in what's charged
  // online now. Mirrors create_booking's v_deposit exactly; a mismatch here
  // would make Razorpay's charge disagree with what the RPC verifies.
  const split =
    effectiveMode === "deposit"
      ? {
          paidNowPaise: depositPaise(base, shop.commissionBps),
          balancePaise: total - depositPaise(base, shop.commissionBps),
        }
      : { paidNowPaise: total, balancePaise: 0 };

  // Delivery needs a hotel to deliver to (147) — same gate trip-book.tsx
  // uses for a hotel-pickup trip's address.
  const canBook = !deliver || hotelName.trim() !== "";

  const reserve = async () => {
    if (busy || !canBook) return;

    setBusy(true);
    setProblem(null);

    try {
      await ensureSession();

      const razorpay =
        split.paidNowPaise < MIN_CHARGE_PAISE
          ? undefined
          : await chargeViaRazorpay({
              amountPaise: split.paidNowPaise,
              receipt: makeReceipt(`rental-${shop.slug}`),
              description: `${chosen.model} — ${shop.name}`,
            });

      const result = await bookNow({
        kind: "rental",
        subject: shop.slug,
        startsAt: instantIso(pickupDateKey, pickupMins),
        units: days,
        variant: chosen.id,
        extras: deliver,
        deliveryHotel: deliver ? hotelName.trim() : undefined,
        payMode: effectiveMode,
        razorpay,
      });

      if (!result.ok) {
        setProblem(result.message);
        setBusy(false);
        return;
      }

      router.push(
        `/booked?type=rental&id=${shop.slug}&v=${chosen.id}&d=${days}&pt=${pickupMins}&pdk=${pickupDateKey}&deliver=${deliver ? 1 : 0}&pay=${effectiveMode}&ref=${result.ref}`,
      );
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Something went wrong.");
      setBusy(false);
    }
  };

  const groups = (["scooter", "bike", "bicycle"] as VehicleType[])
    .map((t) => ({ type: t, items: shop.vehicles.filter((v) => v.type === t) }))
    .filter((g) => g.items.length > 0);

  // From `lg` the form is the left column and the price summary, with its own Pay button,
  // is a sticky card on the right; the fixed bottom bar below is phone-only.
  return (
    <>
      <main className="page-well pt-4 pb-36 lg:grid lg:grid-cols-12 lg:gap-x-12 lg:pt-8 lg:pb-24">
        <div className="lg:col-span-7">
        <ExpandableText
          text={shop.blurb}
          className="text-[13px] leading-relaxed font-medium text-muted"
        />

        <div className="mt-5 flex items-start gap-3 rounded-[18px] border border-line bg-surface p-4">
          <div className="min-w-0 flex-1">
            <p className="text-[10.5px] font-bold tracking-wider text-muted uppercase">
              {deliver ? "Delivery" : "Pick up"}
            </p>
            {/* Wraps rather than truncates. Two of these share a phone's width,
                so "Fri, Sep 25, 9:00 AM" clipped to "Fri, Sep 25, 9:00 ..." -
                hiding the one detail the row exists to state. */}
            <p className="mt-0.5 text-[15px] leading-snug font-bold">{pickupLabel}</p>
          </div>
          <div className="h-9 w-px shrink-0 bg-hairline" />
          <div className="min-w-0 flex-1">
            <p className="text-[10.5px] font-bold tracking-wider text-muted uppercase">
              Return
            </p>
            <p className="mt-0.5 text-[15px] leading-snug font-bold">{returnLabel}</p>
          </div>
        </div>

        <div className="mt-2.5 rounded-[15px] border border-line bg-surface p-3.5">
          <p className="text-[12px] font-bold tracking-wider text-muted uppercase">
            {deliver ? "Delivery date" : "Pick-up date"}
          </p>
          <p className="mt-0.5 text-[11.5px] font-medium text-muted">
            {deliver
              ? "Any day this trip — the shop drops it at your hotel."
              : "Any day this trip, not just today."}
          </p>
          <div className="no-bar mt-3 flex gap-2 overflow-x-auto pb-0.5">
            {dateChips.map((d) => {
              const on = d.key === pickupDateKey;
              const disabled = optionsFor(shop.hours, d.key).length === 0;
              return (
                <button
                  key={d.key}
                  type="button"
                  aria-pressed={on}
                  disabled={disabled}
                  onClick={() => selectDate(d.key)}
                  className={`h-14 shrink-0 rounded-xl border px-3.5 text-center disabled:opacity-40 ${
                    on ? "border-brand bg-brand text-white" : "border-line bg-surface"
                  }`}
                >
                  <span className="block text-[10px] font-bold tracking-wide uppercase opacity-70">
                    {d.label}
                  </span>
                  <span className="mt-0.5 block text-[13.5px] font-bold">
                    {d.num} {d.month}
                  </span>
                </button>
              );
            })}
          </div>

          <p className="mt-4 text-[12px] font-bold tracking-wider text-muted uppercase">
            {deliver ? "Delivery time" : "Pick-up time"}
          </p>
          <p className="mt-0.5 text-[11.5px] font-medium text-muted">
            {deliver
              ? `When you want it at your hotel.`
              : `When you'll collect it, so ${shop.name} has it ready.`}
          </p>
          <div className="mt-3 grid grid-cols-4 gap-2">
            {pickupOptions.map((o) => {
              const on = o.mins === pickupMins;
              return (
                <button
                  key={o.mins}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    setPickupMins(o.mins);
                    setProblem(null);
                  }}
                  className={`h-10 rounded-xl border text-[12.5px] font-bold ${
                    on ? "border-brand bg-brand text-white" : "border-line bg-surface"
                  }`}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-2.5 flex items-center justify-between rounded-[15px] border border-line bg-surface px-4 py-2.5">
          <span className="text-[14px] font-semibold">How many days?</span>
          <div className="flex items-center gap-3.5">
            <button
              type="button"
              aria-label="Fewer days"
              onClick={() => setDays(Math.max(1, days - 1))}
              className="h-11 w-11 rounded-xl border border-line bg-ground text-lg font-bold text-brand"
            >
              −
            </button>
            <span className="w-5 text-center text-[17px] font-bold">{days}</span>
            <button
              type="button"
              aria-label="More days"
              onClick={() => setDays(Math.min(MAX_DAYS, days + 1))}
              className="h-11 w-11 rounded-xl bg-brand text-lg font-bold text-white"
            >
              +
            </button>
          </div>
        </div>

        {groups.map((g) => {
          const Icon = TYPE_ICON[g.type];
          return (
            <section key={g.type}>
              <h2 className="mt-6 text-[12px] font-bold tracking-wider text-muted uppercase">
                {TYPE_LABEL[g.type]}
              </h2>

              <ul className="mt-3 flex flex-col gap-2.5">
                {g.items.map((v) => {
                  const on = v.id === pick;
                  const left = availableFor(shop, v.id, pickupDateKey, days);
                  const out = left <= 0;
                  return (
                    <li key={v.id}>
                      <button
                        type="button"
                        aria-pressed={on}
                        disabled={out}
                        onClick={() => {
                          setPick(v.id);
                          setProblem(null);
                        }}
                        className={`flex w-full items-center gap-3.5 rounded-[18px] border bg-surface p-3.5 text-left transition ${
                          out
                            ? "border-line opacity-55"
                            : on
                              ? "border-brand shadow-md"
                              : "border-line"
                        }`}
                      >
                        {v.photos.length > 0 ? (
                          <span className="relative flex h-[58px] w-[58px] shrink-0 items-center justify-center overflow-hidden rounded-[15px] border border-line bg-ground">
                            <Image
                              src={v.photos[0]}
                              alt=""
                              fill
                              sizes="58px"
                              loading="lazy"
                              className="object-cover"
                            />
                          </span>
                        ) : (
                          <span className="flex h-[58px] w-[58px] shrink-0 items-center justify-center rounded-[15px] bg-brandsoft text-brand">
                            <Icon size={30} />
                          </span>
                        )}

                        <span className="min-w-0 flex-1">
                          <span className="block text-[15px] font-bold">{v.model}</span>
                          <span className="mt-1 block text-[12px] font-medium text-muted">
                            {out
                              ? "Sold out for these dates"
                              : left <= 2
                                ? `${v.meta} · ${left} left`
                                : v.meta}
                          </span>
                        </span>

                        <span className="shrink-0 text-right">
                          <span className="block text-[16px] font-bold text-brand">
                            {rupees(v.ratePaise)}
                          </span>
                          <span className="block text-[11px] font-semibold text-muted">
                            per day
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}

        <button
          type="button"
          aria-pressed={deliver}
          onClick={() => setDeliver(!deliver)}
          className={`mt-5 flex w-full items-center gap-3 rounded-[15px] border p-3.5 text-left ${
            deliver ? "border-brandsoft bg-brandsoft" : "border-line bg-surface"
          }`}
        >
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border ${
              deliver ? "border-brand bg-brand text-white" : "border-line bg-surface"
            }`}
          >
            {deliver && <CheckIcon size={14} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-bold">Deliver to my hotel</span>
            <span className="mt-0.5 block text-[12px] font-medium text-muted">
              Dropped at reception at the time you choose above
            </span>
          </span>
          <span className="shrink-0 text-[14px] font-bold text-brand">
            +{rupees(DELIVERY_PAISE)}
          </span>
        </button>

        {deliver && (
          <label className="mt-2.5 flex flex-col gap-1.5 rounded-[15px] border border-line bg-surface p-3.5">
            <span className="text-[12px] font-bold text-muted">Which hotel?</span>
            <input
              type="text"
              value={hotelName}
              onChange={(e) => setHotelName(e.target.value)}
              placeholder="Hotel or guesthouse name"
              className="h-11 rounded-xl border border-line bg-ground px-3.5 text-[14px] font-semibold outline-none focus:border-brand"
            />
            <span className="text-[11.5px] font-medium text-muted">
              {shop.name} needs this to know where to drop it off.
            </span>
          </label>
        )}

        <div className="mt-2.5 flex items-center gap-3 rounded-[15px] border border-line bg-surface p-3.5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brandsoft text-brand">
            <LicenceIcon size={20} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-bold">Driving licence on file</span>
            <span className="mt-0.5 block text-[12px] font-medium text-muted">
              Not needed for cycles
            </span>
          </span>
          <CheckIcon size={20} className="shrink-0 text-brand" />
        </div>

        </div>

        <div className="lg:sticky lg:top-24 lg:self-start lg:col-span-5 lg:col-start-8 lg:row-start-1">
        <div className="mt-6 flex flex-col gap-2.5 rounded-card border border-line bg-surface p-4 lg:mt-0 lg:p-6 lg:shadow-card">
          <div className="flex justify-between text-[13.5px]">
            <span className="font-medium text-muted">
              {rupees(chosen.ratePaise)} × {days} {dayWord}
            </span>
            <span className="font-semibold">{rupees(base)}</span>
          </div>

          {deliver && (
            <div className="flex justify-between text-[13.5px]">
              <span className="font-medium text-muted">Hotel delivery</span>
              <span className="font-semibold">{rupees(DELIVERY_PAISE)}</span>
            </div>
          )}

          <div className="flex justify-between text-[13.5px]">
            <span className="font-medium text-muted">Fuel</span>
            <span className="font-semibold">
              {chosen.type === "bicycle" ? "Not applicable" : "Full to full, on you"}
            </span>
          </div>

          <div className="flex justify-between border-t border-hairline pt-2.5 text-[16px] font-bold">
            <span>Total</span>
            <span>{rupees(total)}</span>
          </div>

          <PayChoice
            pricePaise={total}
            mode={shop.paymentMode}
            payMode={payMode}
            commissionBps={shop.commissionBps}
            onChange={(next) => {
              setPayMode(next);
              setProblem(null);
            }}
            counterLabel={`to ${shop.name} on ${deliver ? "delivery" : "pick-up"}`}
            nonCommissionablePaise={deliver ? DELIVERY_PAISE : 0}
          />

          {chosen.securityDepositPaise > 0 && (
            <p className="mt-1 text-[11.5px] leading-relaxed font-medium text-muted">
              A {rupees(chosen.securityDepositPaise)} refundable security deposit is paid
              directly to {shop.name} on {deliver ? "delivery" : "pick-up"}.
            </p>
          )}
        
          <div className="hidden lg:block">
            {problem && (
              <p className="mb-3 rounded-xl border border-sandline bg-sandsoft px-3.5 py-2.5 text-[12px] leading-relaxed font-medium text-sandink2">
                {problem}
              </p>
            )}
            <button
              type="button"
              disabled={busy || soldOut || !canBook}
              onClick={reserve}
              className="flex h-13 w-full items-center justify-center gap-2 rounded-2xl bg-brand px-6 text-[15px] font-bold text-white disabled:opacity-60"
            >
              {soldOut ? "Sold out" : busy ? "Booking…" : `Pay ${rupees(split.paidNowPaise)} & book`}
              <ChevronIcon size={18} />
            </button>
            {!canBook && (
              <p className="mt-2.5 text-center text-[12px] leading-relaxed text-muted">
                Add the hotel name to continue.
              </p>
            )}
          </div>
        </div>
        </div>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface lg:hidden">
        {problem && (
          <p className="page-flow border-b border-sandline bg-sandsoft py-2.5 text-[12px] leading-relaxed font-medium text-sandink2">
            {problem}
          </p>
        )}
        {/* pb keys off --safe-bottom rather than a flat pb-6, so the button
            clears the home indicator on a notched phone and does not float
            above a pointless gap on one without. */}
        <div className="page-flow flex items-center gap-3.5 pt-3.5 pb-[max(1.5rem,calc(var(--safe-bottom)+0.5rem))]">
          <div className="min-w-0 flex-1">
            {/* Not truncated. "Pay X now, Y on pick-up" is the one line that
                tells someone what they are about to be charged, and clipping
                it to "...on pi..." at 11px was worse than letting it wrap. */}
            <p className="text-[11px] leading-snug font-semibold text-muted">
              {split.balancePaise > 0
                ? `Pay ${rupees(split.paidNowPaise)} now, ${rupees(split.balancePaise)} on ${deliver ? "delivery" : "pick-up"}`
                : "Pay now"}
            </p>
            <p className="mt-0.5 text-[19px] font-bold tracking-tight">
              {rupees(split.paidNowPaise)}
            </p>
          </div>
          <button
            type="button"
            disabled={busy || soldOut || !canBook}
            onClick={reserve}
            className="flex h-13 shrink-0 items-center gap-2 rounded-2xl bg-brand px-6 py-3.5 text-[15px] font-bold text-white disabled:opacity-60"
          >
            {soldOut ? "Sold out" : busy ? "Booking…" : !canBook ? "Add hotel" : "Pay & book"}
            <ChevronIcon size={18} />
          </button>
        </div>
      </div>
    </>
  );
}
