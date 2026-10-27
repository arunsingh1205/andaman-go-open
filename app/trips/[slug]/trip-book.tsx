"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { bookTrip, type TripTraveller } from "@/lib/book";
import { paymentSplit, type PayMode } from "@/lib/payments";
import { ensureSession } from "@/lib/supabase-browser";
import { chargeViaRazorpay, makeReceipt, MIN_CHARGE_PAISE } from "@/lib/razorpay-client";
import { rupees } from "@/lib/activities";
import { seatsLeft, seatsToConfirm, type Trip } from "@/lib/trips";
import { CheckIcon } from "@/app/icons";
import DirectionsButton from "@/app/directions-button";
import ExpandableText from "@/app/expandable-text";
import PayChoice from "@/app/pay-choice";
import PromoCodeField from "@/app/promo-code-field";

const DIFFICULTY_LABEL: Record<Trip["difficulty"], string> = {
  easy: "Easy going",
  moderate: "Moderately active",
  challenging: "Physically challenging",
};

type Draft = { fullName: string; age: string };
const emptyDraft = (): Draft => ({ fullName: "", age: "" });

const travellerLabel = "text-[11.5px] font-bold text-muted";
const travellerNameInput =
  "h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3.5 text-[14px] font-semibold outline-none focus:border-brand";
const travellerAgeInput =
  "h-11 w-16 shrink-0 rounded-xl border border-line bg-surface px-2.5 text-center text-[14px] font-semibold outline-none focus:border-brand";

/** A UI ceiling for the stepper — an uncapped trip has no real seat limit,
 *  but a picker still needs to stop somewhere reasonable. */
const MAX_SEATS = 20;

export default function TripBook({ trip }: { trip: Trip }) {
  const router = useRouter();
  const [seats, setSeatsState] = useState(2);
  const [travellers, setTravellers] = useState<Draft[]>(() =>
    Array.from({ length: 2 }, emptyDraft),
  );
  const [payMode, setPayMode] = useState<PayMode>("deposit");
  const [hotelAddress, setHotelAddress] = useState("");
  const [promoCode, setPromoCode] = useState<string | null>(null);
  const [discountPaise, setDiscountPaise] = useState(0);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // 'full' unless the category allows a deposit and the traveller picked
  // one — except with a promo code applied, which always forces full
  // payment. A deposit's balance is cash the host collects in person,
  // outside Andaman Go's control, so a discount can only ever come out of
  // Andaman Go's own commission (see create_booking, 161) when the whole
  // (discounted) price is collected online instead.
  const hasDiscount = discountPaise > 0;
  const effectiveMode: PayMode = hasDiscount ? "full" : trip.paymentMode === "choice" ? payMode : "full";

  const left = seatsLeft(trip);

  // Seats and the traveller list are the same number, always — grow or
  // shrink the drafts array to match whenever the stepper moves.
  const setSeats = (next: number) => {
    const clamped = Math.max(1, Math.min(MAX_SEATS, left, next));
    setSeatsState(clamped);
    setTravellers((prev) =>
      clamped > prev.length
        ? [...prev, ...Array.from({ length: clamped - prev.length }, emptyDraft)]
        : prev.slice(0, clamped),
    );
  };

  const setTraveller = (i: number, patch: Partial<Draft>) =>
    setTravellers((prev) => prev.map((t, n) => (n === i ? { ...t, ...patch } : t)));

  const travellersValid = travellers.every((t) => {
    const age = parseInt(t.age, 10);
    return t.fullName.trim() !== "" && !isNaN(age) && age >= 0 && age <= 120;
  });

  // A hotel-pickup trip needs to know where to collect the traveller (076).
  const canBook = travellersValid && (!trip.meetAtHotel || hotelAddress.trim() !== "");

  const hold = async () => {
    if (busy || !canBook) return;

    setBusy(true);
    setProblem(null);

    const travellerList: TripTraveller[] = travellers.map((t) => ({
      fullName: t.fullName.trim(),
      age: parseInt(t.age, 10),
    }));

    try {
      await ensureSession();

      const discountedTotal = Math.max(0, trip.pricePaise * seats - discountPaise);
      const paidNow = paymentSplit(discountedTotal, effectiveMode, trip.commissionBps).paidNowPaise;
      const razorpay =
        paidNow < MIN_CHARGE_PAISE
          ? undefined
          : await chargeViaRazorpay({
              amountPaise: paidNow,
              receipt: makeReceipt(`trip-${trip.slug}`),
              description: trip.title,
            });

      const result = await bookTrip({
        kind: "trip",
        subject: trip.slug,
        startsAt: trip.startsAt,
        party: seats,
        payMode: effectiveMode,
        travellers: travellerList,
        hotelAddress: trip.meetAtHotel ? hotelAddress.trim() : undefined,
        promoCode: promoCode ?? undefined,
        razorpay,
      });

      if (!result.ok) {
        setProblem(result.message);
        setBusy(false);
        return;
      }

      router.push(
        `/booked?type=trip&id=${trip.slug}&n=${seats}&pay=${effectiveMode}&ref=${result.ref}`,
      );
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Something went wrong.");
      setBusy(false);
    }
  };

  const toGo = seatsToConfirm(trip);
  const total = trip.pricePaise * seats;
  const discountedTotal = Math.max(0, total - discountPaise);
  const split = paymentSplit(discountedTotal, effectiveMode, trip.commissionBps);
  const deposit = split.paidNowPaise;
  const balance = split.balancePaise;

  return (
    // Below `lg` this is one column, exactly as before. From `lg` the wrapper vanishes
    // (display: contents) so its two halves become cells of the page's grid: the trip
    // details on the left, the seats and payment form as a sticky card on the right.
    <div className="pt-4 pb-8 lg:contents">
      <div className="lg:col-span-7 lg:pt-6">
      <ExpandableText text={trip.summary} className="text-[14px] leading-relaxed text-muted" />

        <span className="mt-3 inline-flex w-fit items-center rounded-full bg-ground px-2.5 py-1 text-[11px] font-bold text-muted">
          {DIFFICULTY_LABEL[trip.difficulty]}
        </span>

        {!trip.isOpen ? (
          <div className="mt-5 rounded-2xl border border-sandline bg-sandsoft p-3.5">
            <p className="text-[12.5px] leading-relaxed font-medium text-sandink2">
              <strong className="font-bold">This trip isn&apos;t running on its next date.</strong>{" "}
              {trip.closedReason} Check back for the run after that.
            </p>
          </div>
        ) : (
          <div
            className={`mt-5 flex gap-3 rounded-2xl border p-3.5 ${
              toGo > 0 ? "border-sandline bg-sandsoft" : "border-brandsoft bg-brandsoft"
            }`}
          >
            <p
              className={`text-[12.5px] leading-relaxed font-medium ${
                toGo > 0 ? "text-sandink2" : "text-brand"
              }`}
            >
              {toGo > 0 ? (
                <>
                  <strong className="font-bold">
                    {toGo} more {toGo === 1 ? "person" : "people"} needed
                  </strong>{" "}
                  for this trip to run. If it doesn&apos;t fill by the evening before, your
                  payment comes straight back — you won&apos;t be left waiting at the jetty.
                </>
              ) : (
                <>
                  <strong className="font-bold">This trip is confirmed to run.</strong>{" "}
                  {left === Infinity
                    ? `Seats open with ${trip.host}.`
                    : `${left} ${left === 1 ? "seat" : "seats"} left with ${trip.host}.`}
                </>
              )}
            </p>
          </div>
        )}

        <h2 className="mt-6 text-[12px] font-bold tracking-wider text-muted uppercase">
          What&apos;s included
        </h2>
        <ul className="mt-3 flex flex-col gap-2.5">
          {trip.includes.map((line) => (
            <li key={line} className="flex items-start gap-2.5">
              <CheckIcon size={16} className="mt-0.5 shrink-0 text-brand" />
              <span className="text-[13.5px] leading-snug font-medium">{line}</span>
            </li>
          ))}
        </ul>

        {trip.bringList.length > 0 && (
          <>
            <h2 className="mt-6 text-[12px] font-bold tracking-wider text-muted uppercase">
              What to bring
            </h2>
            <ul className="mt-3 flex flex-col gap-2.5">
              {trip.bringList.map((line) => (
                <li key={line} className="flex items-start gap-2.5">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-muted" />
                  <span className="text-[13.5px] leading-snug font-medium">{line}</span>
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="mt-5 rounded-[15px] border border-line bg-surface p-3.5">
          <p className="text-[10.5px] font-bold tracking-wider text-muted uppercase">
            Meeting point
          </p>
          <p className="mt-1 text-[14px] font-bold">
            {trip.meetAtHotel ? "Pickup from your accommodation" : trip.meetPoint}
          </p>
          <p className="mt-1 text-[12px] font-medium text-muted">
            {trip.nextDateLabel} · pickup {trip.departsLabel}
            {trip.endsLabel && ` · back by ~${trip.endsLabel}`}
          </p>
          {!trip.meetAtHotel && trip.mapsUrl && (
            <DirectionsButton
              className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-ground px-3 text-[12px] font-bold text-brand"
              directions={{
                addressLabel: trip.meetPoint || null,
                query: `${trip.meetPoint}, ${trip.island}, Andaman`,
                mapsUrl: trip.mapsUrl,
              }}
            />
          )}
        </div>

        </div>

      <div className="lg:sticky lg:top-24 lg:self-start lg:col-span-5 lg:col-start-8 lg:row-span-3 lg:row-start-1 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:[scrollbar-width:thin] lg:rounded-panel lg:border lg:border-line lg:bg-surface lg:p-6 lg:shadow-card lg:[&>:first-child]:mt-0">

        {trip.meetAtHotel && (
          <label className="mt-5 flex flex-col gap-1.5">
            <span className="text-[12px] font-bold text-muted">Where are you staying?</span>
            <textarea
              value={hotelAddress}
              onChange={(e) => setHotelAddress(e.target.value)}
              rows={2}
              placeholder="Hotel / guesthouse name and area"
              className="rounded-xl border border-line bg-surface px-3.5 py-3 text-[14px] font-semibold outline-none focus:border-brand"
            />
            <span className="text-[11.5px] font-medium text-muted">
              {trip.host} needs this to come and collect you.
            </span>
          </label>
        )}

        <h2 className="mt-6 text-[12px] font-bold tracking-wider text-muted uppercase">
          How many seats?
        </h2>
        <div className="mt-3 flex items-center justify-between rounded-[15px] border border-line bg-surface px-4 py-2.5">
          <span className="text-[14px] font-semibold">Seats</span>
          <div className="flex items-center gap-3.5">
            <button
              type="button"
              aria-label="Fewer seats"
              onClick={() => setSeats(seats - 1)}
              className="h-11 w-11 rounded-xl border border-line bg-ground text-lg font-bold text-brand"
            >
              −
            </button>
            <span className="w-5 text-center text-[17px] font-bold">{seats}</span>
            <button
              type="button"
              aria-label="More seats"
              onClick={() => setSeats(seats + 1)}
              className="h-11 w-11 rounded-xl bg-brand text-lg font-bold text-white"
            >
              +
            </button>
          </div>
        </div>

        <h2 className="mt-6 text-[12px] font-bold tracking-wider text-muted uppercase">
          Who&apos;s coming?
        </h2>
        <div className="mt-3 flex flex-col gap-2.5">
          {travellers.map((t, i) => (
            <div key={i} className="rounded-2xl border border-line bg-surface p-3.5">
              <span className="text-[12px] font-bold text-brand">Traveller {i + 1}</span>
              <div className="mt-2 flex gap-2">
                <label className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className={travellerLabel}>Full name</span>
                  <input
                    value={t.fullName}
                    onChange={(e) => setTraveller(i, { fullName: e.target.value })}
                    placeholder="e.g. Arjun Rao"
                    className={travellerNameInput}
                  />
                </label>
                <label className="flex shrink-0 flex-col gap-1">
                  <span className={travellerLabel}>Age</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    value={t.age}
                    onChange={(e) => setTraveller(i, { age: e.target.value })}
                    className={travellerAgeInput}
                  />
                </label>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 rounded-2xl border border-line bg-surface p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-[13.5px] text-muted">
              {rupees(trip.pricePaise)} × {seats}
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
            kind="trip"
            subject={trip.slug}
            orderPaise={total}
            onApplied={(code, discount) => {
              setPromoCode(code);
              setDiscountPaise(discount);
            }}
          />

          <PayChoice
            pricePaise={discountedTotal}
            mode={hasDiscount ? "full" : trip.paymentMode}
            payMode={payMode}
            commissionBps={trip.commissionBps}
            onChange={(next) => {
              setPayMode(next);
              setProblem(null);
            }}
            counterLabel={`to ${trip.host} on the day, in cash`}
          />
          {hasDiscount && trip.paymentMode === "choice" && (
            <p className="mt-2 text-[11.5px] font-medium text-muted">
              Promo codes are paid in full now — no deposit option while one&apos;s applied.
            </p>
          )}

          {balance > 0 && (
            <div className="flex justify-between border-t border-hairline pt-2.5 mt-2.5 text-[13.5px]">
              <span className="font-medium text-muted">
                To {trip.host} on the day, in cash
              </span>
              <span className="font-semibold">{rupees(balance)}</span>
            </div>
          )}

          {problem && (
            <p className="mt-3 rounded-xl border border-sandline bg-sandsoft px-3.5 py-2.5 text-[12.5px] leading-relaxed font-medium text-sandink2">
              {problem}
            </p>
          )}

          <button
            type="button"
            disabled={busy || !trip.isOpen || !canBook}
            onClick={hold}
            className={`mt-4 w-full rounded-2xl py-3.5 text-[15px] font-bold ${
              trip.isOpen && canBook && !busy ? "bg-brand text-white" : "bg-line text-muted"
            }`}
          >
            {!trip.isOpen
              ? "Not running"
              : busy
                ? "Booking…"
                : `Pay ${rupees(deposit)} & book`}
          </button>

          <p className="mt-3 text-center text-[12px] leading-relaxed text-muted">
            {!trip.isOpen
              ? "Check back for the run after this one."
              : !travellersValid
                ? "Add every traveller's name and age to continue."
                : trip.meetAtHotel && hotelAddress.trim() === ""
                  ? "Tell the host where you're staying to continue."
                  : balance > 0
                    ? `${rupees(balance)} more to pay in person on the day`
                    : "Confirmed as soon as you pay"}
          </p>
        </div>
      </div>
    </div>
  );
}
