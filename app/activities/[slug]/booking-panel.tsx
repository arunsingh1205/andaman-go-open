"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { rupees, seatsLeft, type Activity } from "@/lib/activities";
import { bookActivity } from "@/lib/book";
import { saveMyPhone } from "@/lib/profile";
import { paymentSplit, type PayMode } from "@/lib/payments";
import { ensureSession } from "@/lib/supabase-browser";
import { chargeViaRazorpay, makeReceipt, MIN_CHARGE_PAISE } from "@/lib/razorpay-client";
import PayChoice from "@/app/pay-choice";
import PromoCodeField from "@/app/promo-code-field";

type Draft = { fullName: string; age: string };
const emptyDraft = (): Draft => ({ fullName: "", age: "" });

const guestLabel = "text-[11.5px] font-bold text-muted";
const guestNameInput =
  "h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3.5 text-[14px] font-semibold outline-none focus:border-brand";
const guestAgeInput =
  "h-11 w-16 shrink-0 rounded-xl border border-line bg-surface px-2.5 text-center text-[14px] font-semibold outline-none focus:border-brand";

export default function BookingPanel({
  activity,
  initialPhone,
}: {
  activity: Activity;
  initialPhone: string | null;
}) {
  const router = useRouter();
  const days = [...new Set(activity.slots.map((s) => s.dayKey))];

  const [dayKey, setDayKey] = useState(days[0]);
  const [slotId, setSlotId] = useState<string | null>(null);
  const [guestDrafts, setGuestDrafts] = useState<Draft[]>(() =>
    Array.from({ length: 2 }, emptyDraft),
  );
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [payMode, setPayMode] = useState<PayMode>("deposit");
  const [promoCode, setPromoCode] = useState<string | null>(null);
  const [discountPaise, setDiscountPaise] = useState(0);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const guests = guestDrafts.length;
  const daySlots = activity.slots.filter((s) => s.dayKey === dayKey);
  const slot = activity.slots.find((s) => s.id === slotId) ?? null;
  const total = activity.pricePaise * guests;
  const discountedTotal = Math.max(0, total - discountPaise);
  const maxGuests = slot ? Math.max(1, Math.min(8, seatsLeft(slot))) : 8;

  // Grow or shrink the guest list to match the stepper, clamped to what's left.
  const setGuestCount = (next: number) => {
    const clamped = Math.max(1, Math.min(maxGuests, next));
    setGuestDrafts((prev) =>
      clamped > prev.length
        ? [...prev, ...Array.from({ length: clamped - prev.length }, emptyDraft)]
        : prev.slice(0, clamped),
    );
  };

  const setGuest = (i: number, patch: Partial<Draft>) =>
    setGuestDrafts((prev) => prev.map((g, n) => (n === i ? { ...g, ...patch } : g)));

  const guestsValid = guestDrafts.every((g) => {
    const age = parseInt(g.age, 10);
    return g.fullName.trim() !== "" && !isNaN(age) && age >= 0 && age <= 120;
  });
  const phoneValid = phone.trim() !== "";
  const ready = Boolean(slot) && guestsValid && phoneValid;

  // 'full' unless the category allows a deposit and the traveller picked
  // one — except with a promo code applied, which always forces full
  // payment. A deposit's balance is cash the operator collects in person,
  // outside Andaman Go's control, so a discount can only ever come out of
  // Andaman Go's own commission (see create_booking, 161) when the whole
  // (discounted) price is collected online instead.
  const hasDiscount = discountPaise > 0;
  const effectiveMode: PayMode = hasDiscount ? "full" : activity.paymentMode === "choice" ? payMode : "full";
  const split = paymentSplit(discountedTotal, effectiveMode, activity.commissionBps);

  const request = async () => {
    if (!slot || busy || !ready) return;

    setBusy(true);
    setProblem(null);

    try {
      // Make sure there is an identity before asking to book with it. On a
      // slow connection somebody can get here before start-up finished.
      await ensureSession();

      // Save the number first, before any charge: set_my_phone (007) puts it
      // on the profile, and create_booking then copies it onto the new
      // booking. A bad number should stop the flow here, not after payment.
      if (phone.trim() !== (initialPhone ?? "")) {
        const saved = await saveMyPhone(phone);
        if (!saved.ok) {
          setProblem(saved.message);
          setBusy(false);
          return;
        }
      }

      // A genuinely free activity (price_paise 0) has nothing to charge —
      // skip Razorpay entirely rather than send it an amount below its
      // ₹1 minimum. create_booking (063) only demands a payment id when
      // money is actually due, so this stays consistent with the DB.
      const razorpay =
        split.paidNowPaise < MIN_CHARGE_PAISE
          ? undefined
          : await chargeViaRazorpay({
              amountPaise: split.paidNowPaise,
              receipt: makeReceipt(`activity-${activity.slug}`),
              description: `${activity.name} — ${slot.dayLabel} ${slot.dayNum}, ${slot.timeLabel}`,
            });

      const result = await bookActivity({
        kind: "activity",
        subject: activity.slug,
        startsAt: slot.startsAt,
        party: guests,
        payMode: effectiveMode,
        razorpay,
        promoCode: promoCode ?? undefined,
        guests: guestDrafts.map((g) => ({
          fullName: g.fullName.trim(),
          age: parseInt(g.age, 10),
        })),
      });

      if (!result.ok) {
        setProblem(result.message);
        setBusy(false);
        return;
      }

      router.push(
        `/booked?type=activity&id=${activity.slug}&slot=${slot.id}&n=${guests}&pay=${effectiveMode}&ref=${result.ref}`,
      );
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Something went wrong.");
      setBusy(false);
    }
  };

  // Changing anything clears a stale complaint about a slot they have moved on from.
  const change = (fn: () => void) => {
    fn();
    setProblem(null);
  };

  if (activity.slots.length === 0) {
    return (
      <div className="mt-8 rounded-2xl border border-line bg-surface p-5 text-center">
        <p className="text-[13.5px] leading-relaxed font-medium text-muted">
          {activity.operator.split(" · ")[0]} hasn&apos;t published times for this yet —
          check back soon.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-8">
      <h2 className="text-[12px] font-bold tracking-wider text-muted uppercase">
        Pick a day
      </h2>
      <div className="no-bar mt-3 flex gap-2 overflow-x-auto pb-1 lg:flex-wrap lg:overflow-visible">
        {days.map((key) => {
          const first = activity.slots.find((s) => s.dayKey === key)!;
          const on = key === dayKey;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={on}
              onClick={() =>
                change(() => {
                  setDayKey(key);
                  setSlotId(null);
                })
              }
              className={`flex h-[76px] w-[60px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-2xl border text-sm ${
                on
                  ? "border-brand bg-brand text-white"
                  : "border-line bg-surface text-ink"
              }`}
            >
              <span className="text-[11px] opacity-75">{first.dayLabel}</span>
              <span className="text-[18px] leading-none font-bold">{first.dayNum}</span>
              <span className="text-[9px] font-bold tracking-wide uppercase opacity-75">
                {first.month}
              </span>
            </button>
          );
        })}
      </div>

      <h2 className="mt-7 text-[12px] font-bold tracking-wider text-muted uppercase">
        Pick a time
      </h2>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {daySlots.map((s) => {
          const left = seatsLeft(s);
          const available = s.isOpen && left > 0;
          const on = s.id === slotId;
          return (
            <button
              key={s.id}
              type="button"
              disabled={!available}
              aria-pressed={on}
              onClick={() =>
                change(() => {
                  setSlotId(s.id);
                  const cap = Math.max(1, Math.min(8, left));
                  setGuestDrafts((prev) => (prev.length > cap ? prev.slice(0, cap) : prev));
                })
              }
              className={`flex h-[62px] flex-col justify-center rounded-2xl border px-3.5 text-left ${
                !available
                  ? "cursor-not-allowed border-line bg-ground text-muted/60"
                  : on
                    ? "border-brand bg-brand text-white"
                    : "border-line bg-surface"
              }`}
            >
              <span className="text-[14.5px] font-bold">{s.timeLabel}</span>
              <span
                className={`text-[11px] font-semibold ${
                  !available
                    ? "text-muted/60"
                    : on
                      ? "opacity-75"
                      : left <= 3
                        ? "text-warn"
                        : "text-muted"
                }`}
              >
                {!s.isOpen
                  ? (s.closedReason ?? "Not running")
                  : left === Infinity
                    ? "Open"
                    : left > 0
                      ? `${left} seat${left === 1 ? "" : "s"} left`
                      : "Full"}
              </span>
            </button>
          );
        })}
      </div>

      <h2 className="mt-7 text-[12px] font-bold tracking-wider text-muted uppercase">
        Guests
      </h2>
      <div className="mt-3 flex items-center justify-between rounded-2xl border border-line bg-surface px-4 py-2.5">
        <span className="text-[14px] font-semibold">How many people?</span>
        <div className="flex items-center gap-3.5">
          <button
            type="button"
            disabled={guests <= 1}
            onClick={() => change(() => setGuestCount(guests - 1))}
            className="h-11 w-11 rounded-xl border border-line bg-ground text-lg font-bold text-brand disabled:opacity-40"
          >
            −
          </button>
          <span className="w-5 text-center text-[17px] font-bold">{guests}</span>
          <button
            type="button"
            disabled={guests >= maxGuests}
            onClick={() => change(() => setGuestCount(guests + 1))}
            className="h-11 w-11 rounded-xl bg-brand text-lg font-bold text-white disabled:opacity-40"
          >
            +
          </button>
        </div>
      </div>
      {slot && guests >= maxGuests && (
        <p className="mt-2 text-[11.5px] font-medium text-warn">
          Only {maxGuests} seat{maxGuests === 1 ? "" : "s"} left for this time.
        </p>
      )}

      <h2 className="mt-7 text-[12px] font-bold tracking-wider text-muted uppercase">
        Who&apos;s coming?
      </h2>
      <div className="mt-3 flex flex-col gap-2.5">
        {guestDrafts.map((g, i) => (
          <div key={i} className="rounded-2xl border border-line bg-surface p-3.5">
            <span className="text-[12px] font-bold text-brand">Guest {i + 1}</span>
            <div className="mt-2 flex gap-2">
              <label className="flex min-w-0 flex-1 flex-col gap-1">
                <span className={guestLabel}>Full name</span>
                <input
                  value={g.fullName}
                  onChange={(e) => change(() => setGuest(i, { fullName: e.target.value }))}
                  placeholder="e.g. Arjun Rao"
                  className={guestNameInput}
                />
              </label>
              <label className="flex shrink-0 flex-col gap-1">
                <span className={guestLabel}>Age</span>
                <input
                  type="number"
                  inputMode="numeric"
                  value={g.age}
                  onChange={(e) => change(() => setGuest(i, { age: e.target.value }))}
                  className={guestAgeInput}
                />
              </label>
            </div>
          </div>
        ))}
      </div>

      <h2 className="mt-7 text-[12px] font-bold tracking-wider text-muted uppercase">
        Mobile number
      </h2>
      <input
        type="tel"
        inputMode="numeric"
        autoComplete="tel"
        value={phone}
        onChange={(e) => change(() => setPhone(e.target.value))}
        placeholder="98765 43210"
        aria-label="Your mobile number"
        className="mt-3 h-12 w-full rounded-2xl border border-line bg-surface px-4 text-[15px] font-semibold outline-none focus:border-brand"
      />
      <p className="mt-2 text-[11.5px] leading-relaxed font-medium text-muted">
        We&apos;ll WhatsApp your ticket here, and message this number if the weather
        changes anything.
      </p>

      <div className="mt-8 rounded-2xl border border-line bg-surface p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-[13.5px] text-muted">
            {rupees(activity.pricePaise)} × {guests}
          </span>
          <span className="text-[17px] font-bold">{rupees(total)}</span>
        </div>
        {discountPaise > 0 && (
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-[13px] font-semibold text-brand">Promo discount</span>
            <span className="text-[13px] font-bold text-brand">−{rupees(discountPaise)}</span>
          </div>
        )}

        <PromoCodeField
          kind="activity"
          subject={activity.slug}
          orderPaise={total}
          onApplied={(code, discount) => {
            setPromoCode(code);
            setDiscountPaise(discount);
          }}
        />

        <PayChoice
          pricePaise={discountedTotal}
          mode={hasDiscount ? "full" : activity.paymentMode}
          payMode={payMode}
          onChange={(next) => change(() => setPayMode(next))}
          commissionBps={activity.commissionBps}
          counterLabel={`to ${activity.operator.split(" · ")[0]} on the day`}
        />
        {hasDiscount && activity.paymentMode === "choice" && (
          <p className="mt-2 text-[11.5px] font-medium text-muted">
            Promo codes are paid in full now — no deposit option while one&apos;s applied.
          </p>
        )}

        {problem && (
          <p className="mt-3 rounded-xl border border-sandline bg-sandsoft px-3.5 py-2.5 text-[12.5px] leading-relaxed font-medium text-sandink2">
            {problem}
          </p>
        )}

        <button
          type="button"
          disabled={!ready || busy}
          onClick={request}
          className={`mt-4 w-full rounded-2xl py-3.5 text-[15px] font-bold ${
            ready && !busy ? "bg-brand text-white" : "bg-line text-muted"
          }`}
        >
          {busy
            ? "Confirming…"
            : !slot
              ? "Pick a time to continue"
              : !guestsValid
                ? "Add every guest's name and age"
                : !phoneValid
                  ? "Add a mobile number"
                  : `Pay ${rupees(split.paidNowPaise)} & confirm`}
        </button>

        <p className="mt-3 text-center text-[12px] leading-relaxed text-muted">
          {slot
            ? split.balancePaise > 0
              ? `${rupees(split.balancePaise)} more to pay in person on the day`
              : `${slot.timeLabel} · confirmed as soon as you pay`
            : "Choose a time to continue"}
        </p>
      </div>
    </div>
  );
}
