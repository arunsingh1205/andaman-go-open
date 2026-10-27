"use client";

// Booking a stay — mirrors app/cabs/cab-search.tsx's shape: a "pick" step
// (dates, room type, guests) then a "book" step (price breakdown + the
// bespoke partial/full payment choice), not the generic PayChoice component
// (app/pay-choice.tsx, also commission-based now, 138). Every stay booking
// collects at least Andaman Go's commission online (097) — there is no
// free/pay-later option.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { rupees } from "@/lib/activities";
import { addDays, dayKey, fmtDateLabel, todayIST } from "@/lib/date";
import { ensureSession } from "@/lib/supabase-browser";
import { bookStay } from "@/lib/stay-book";
import { chargeViaRazorpay, makeReceipt } from "@/lib/razorpay-client";
import { stayPaymentSplit, checkOutKey, nightsBetween, type Stay, type StayPayMode } from "@/lib/stays";
import { BackIcon, ChevronIcon, CheckIcon } from "@/app/icons";

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="font-medium text-muted">{label}</span>
      <span className="text-right font-semibold">{value}</span>
    </div>
  );
}

function PayOption({
  on,
  onClick,
  title,
  sub,
}: {
  on: boolean;
  onClick: () => void;
  title: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
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
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-bold">{title}</span>
        <span className="block text-[11.5px] font-medium text-muted">{sub}</span>
      </span>
    </button>
  );
}

export default function BookPanel({
  stay,
  commissionBps,
  initialCheckIn,
  initialCheckOut,
  initialGuests,
}: {
  stay: Stay;
  commissionBps: number;
  /** Carried over from the search step (app/stays/page.tsx) via the results
   *  list, so this panel opens pre-filled instead of asking again. */
  initialCheckIn?: string;
  initialCheckOut?: string;
  initialGuests?: number;
}) {
  const router = useRouter();
  const minCheckIn = dayKey(addDays(todayIST(), 1));
  const validInitialCheckIn =
    initialCheckIn && initialCheckIn >= minCheckIn ? initialCheckIn : minCheckIn;

  const [checkIn, setCheckIn] = useState(validInitialCheckIn);
  const [nights, setNights] = useState(() =>
    initialCheckOut && initialCheckOut > validInitialCheckIn
      ? nightsBetween(validInitialCheckIn, initialCheckOut)
      : 2,
  );
  const [party, setParty] = useState(initialGuests && initialGuests >= 1 ? initialGuests : 2);
  const [roomCode, setRoomCode] = useState(stay.roomTypes[0]?.code ?? "");
  const [step, setStep] = useState<"pick" | "book">("pick");
  const [payMode, setPayMode] = useState<StayPayMode>("partial");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const room = stay.roomTypes.find((r) => r.code === roomCode) ?? stay.roomTypes[0] ?? null;
  const eligibleRooms = stay.roomTypes.filter((r) => r.maxGuests >= 1);
  const totalPaise = room ? room.nightlyRatePaise * nights : 0;
  const checkOut = checkOutKey(checkIn, nights);

  const canContinue = Boolean(room) && nights >= 1 && party >= 1 && party <= (room?.maxGuests ?? 0);

  const submit = async () => {
    if (!room || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await ensureSession();

      const split = stayPaymentSplit(totalPaise, payMode, commissionBps);
      const razorpay = await chargeViaRazorpay({
        amountPaise: split.paidNowPaise,
        receipt: makeReceipt(`stay-${stay.slug}-${room.code}`),
        description: `${room.name} — ${stay.name}`,
      });

      const result = await bookStay({
        stay: stay.slug,
        roomType: room.code,
        checkIn,
        nights,
        party,
        payMode,
        razorpay,
      });
      if (!result.ok) {
        setProblem(result.message);
        setBusy(false);
        return;
      }

      const q = new URLSearchParams({
        type: "stay",
        id: stay.slug,
        room: room.code,
        checkin: checkIn,
        nights: String(nights),
        n: String(party),
        pay: payMode,
        ref: result.ref,
      });
      router.push(`/booked?${q.toString()}`);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Something went wrong.");
      setBusy(false);
    }
  };

  if (eligibleRooms.length === 0) {
    return (
      <div className="mt-5 rounded-[18px] border border-dashed border-line bg-surface p-4 text-center text-[13px] font-medium text-muted">
        No room types listed yet — check back soon.
      </div>
    );
  }

  if (step === "book" && room) {
    const split = stayPaymentSplit(totalPaise, payMode, commissionBps);
    return (
      <main className="page-flow pt-6 pb-36 lg:px-0 lg:pt-0 lg:pb-28">
        <button
          type="button"
          onClick={() => setStep("pick")}
          className="flex items-center gap-1.5 text-[13px] font-bold text-muted"
        >
          <BackIcon size={14} />
          {stay.name}
        </button>

        <h1 className="font-display mt-3 text-[20px] font-bold tracking-tight">{room.name}</h1>
        <p className="mt-0.5 text-[12.5px] font-medium text-muted">{stay.name}</p>

        <div className="mt-5 flex flex-col gap-2 rounded-[18px] border border-line bg-surface p-4 text-[13.5px]">
          <Line
            label="Check-in"
            value={fmtDateLabel(new Date(`${checkIn}T00:00:00Z`))}
          />
          <Line label="Check-out" value={fmtDateLabel(new Date(`${checkOut}T00:00:00Z`))} />
          <Line label="Nights" value={`${nights} ${nights === 1 ? "night" : "nights"}`} />
          <Line label="Guests" value={`${party} ${party === 1 ? "guest" : "guests"}`} />
        </div>

        <div className="mt-3 flex flex-col gap-1.5 rounded-[18px] border border-line bg-surface p-4 text-[13.5px]">
          <Line label={`${rupees(room.nightlyRatePaise)} × ${nights} nights`} value={rupees(totalPaise)} />
          <div className="mt-1 flex justify-between border-t border-hairline pt-2 text-[16px] font-bold">
            <span>Total</span>
            <span>{rupees(totalPaise)}</span>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2">
          <PayOption
            on={payMode === "partial"}
            onClick={() => setPayMode("partial")}
            title={`Pay ${rupees(stayPaymentSplit(totalPaise, "partial", commissionBps).paidNowPaise)} now`}
            sub={`${rupees(stayPaymentSplit(totalPaise, "partial", commissionBps).balancePaise)} to the property at check-in`}
          />
          <PayOption
            on={payMode === "full"}
            onClick={() => setPayMode("full")}
            title={`Pay ${rupees(totalPaise)} now`}
            sub="Nothing to pay at the property"
          />
        </div>

        <div className="mt-3 flex flex-col gap-1.5 rounded-[18px] border border-line bg-surface p-4 text-[13.5px]">
          <Line label="Pay Andaman Go online now" value={rupees(split.paidNowPaise)} />
          <Line label="Pay the property at check-in" value={rupees(split.balancePaise)} />
        </div>
        <p className="mt-2 text-[11.5px] font-medium text-muted">
          {stay.houseRules || "The rest of the stay is settled directly with the property."}
        </p>

        {problem && (
          <p className="mt-3 rounded-xl border border-sandline bg-sandsoft px-3.5 py-2.5 text-[12.5px] leading-relaxed font-medium text-sandink2">
            {problem}
          </p>
        )}

        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface">
          <div className="page-flow flex items-center gap-3.5 pt-3.5 pb-[max(1.5rem,calc(var(--safe-bottom)+0.5rem))]">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] font-semibold text-muted">Pay now</p>
              <p className="mt-0.5 text-[19px] font-bold tracking-tight">{rupees(split.paidNowPaise)}</p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={submit}
              className="flex h-13 shrink-0 items-center gap-2 rounded-2xl bg-brand px-6 py-3.5 text-[15px] font-bold text-white disabled:opacity-60"
            >
              {busy ? "Booking…" : "Pay & book"}
              <ChevronIcon size={18} />
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <div className="mt-5 rounded-[20px] border border-line bg-surface p-4">
      <p className="text-[13px] font-bold">Check availability</p>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-[11.5px] font-bold text-muted">Check-in</span>
          <input
            type="date"
            min={minCheckIn}
            value={checkIn}
            onChange={(e) => setCheckIn(e.target.value)}
            className="h-11 rounded-xl border border-line bg-surface px-3 text-[13.5px] font-semibold outline-none focus:border-brand"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[11.5px] font-bold text-muted">Nights</span>
          <div className="flex h-11 items-center justify-between rounded-xl border border-line bg-surface px-2">
            <button
              type="button"
              aria-label="Fewer nights"
              onClick={() => setNights((n) => Math.max(1, n - 1))}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-lg font-bold text-brand"
            >
              −
            </button>
            <span className="text-[14px] font-bold">{nights}</span>
            <button
              type="button"
              aria-label="More nights"
              onClick={() => setNights((n) => Math.min(180, n + 1))}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-lg font-bold text-brand"
            >
              +
            </button>
          </div>
        </label>
      </div>

      <label className="mt-3 flex flex-col gap-1.5">
        <span className="text-[11.5px] font-bold text-muted">Guests</span>
        <div className="flex h-11 items-center justify-between rounded-xl border border-line bg-surface px-2">
          <button
            type="button"
            aria-label="Fewer guests"
            onClick={() => setParty((p) => Math.max(1, p - 1))}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-lg font-bold text-brand"
          >
            −
          </button>
          <span className="text-[14px] font-bold">{party}</span>
          <button
            type="button"
            aria-label="More guests"
            onClick={() => setParty((p) => Math.min(30, p + 1))}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-lg font-bold text-brand"
          >
            +
          </button>
        </div>
      </label>

      <div className="mt-3 flex flex-col gap-1.5">
        <span className="text-[11.5px] font-bold text-muted">Room type</span>
        {eligibleRooms.map((r) => {
          const on = r.code === roomCode;
          return (
            <button
              key={r.code}
              type="button"
              aria-pressed={on}
              onClick={() => setRoomCode(r.code)}
              className={`flex items-center justify-between gap-3 rounded-xl border px-3.5 py-3 text-left ${
                on ? "border-brand bg-brandsoft" : "border-line bg-surface"
              }`}
            >
              <span className="min-w-0">
                <span className="block text-[13px] font-bold">{r.name}</span>
                <span className="block text-[11px] font-medium text-muted">
                  Sleeps {r.maxGuests} · {r.bedrooms} bed{r.bedrooms === 1 ? "room" : "rooms"} ·{" "}
                  {r.bathrooms} bath{r.bathrooms === 1 ? "" : "s"}
                </span>
              </span>
              <span className="shrink-0 text-[13px] font-bold text-brand">
                {rupees(r.nightlyRatePaise)}/night
              </span>
            </button>
          );
        })}
        {room && party > room.maxGuests && (
          <p className="text-[11.5px] font-medium text-warn">
            {room.name} sleeps at most {room.maxGuests}. Choose a bigger room type or fewer guests.
          </p>
        )}
      </div>

      <button
        type="button"
        disabled={!canContinue}
        onClick={() => setStep("book")}
        className="mt-4 flex h-13 w-full items-center justify-center gap-2 rounded-2xl bg-brand text-[15px] font-bold text-white disabled:bg-line disabled:text-muted"
      >
        {room ? `Continue — ${rupees(totalPaise)} total` : "Continue"}
        <ChevronIcon size={18} />
      </button>
    </div>
  );
}
