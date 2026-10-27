"use client";

// Full-day car hire, browsing what each operator actually offers — their own
// car, their own day rate, their own extra km/hour charges once you go over.
// One-way and same-day round trips moved to the standardized rate card
// (Book a ride, rate-card-search.tsx) once that covered them at a fixed
// union fare; full-day hire is the one thing that's genuinely priced by the
// operator, not by Andaman Go, so it's the one thing left here.

import { useMemo, useState } from "react";
import PageBack from "@/app/page-back";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { rupees } from "@/lib/activities";
import { addDays, dayKey, fmtDateLabel, fmtClock, instantIso, todayIST } from "@/lib/date";
import { ensureSession } from "@/lib/supabase-browser";
import { bookCab } from "@/lib/cab-book";
import { chargeViaRazorpay, makeReceipt } from "@/lib/razorpay-client";
import {
  CATEGORY_LABEL,
  FUEL_LABEL,
  cabPaymentSplit,
  fareBreakdown,
  isNightPickup,
  type CabOperator,
  type CabPayMode,
} from "@/lib/cabs";
import { BackIcon, CarIcon, CheckIcon, ChevronIcon } from "@/app/icons";

const DAY_START_HOUR = 5;
const DAY_END_HOUR = 22;
const PICKUP_TIMES = Array.from(
  { length: DAY_END_HOUR - DAY_START_HOUR + 1 },
  (_, i) => (DAY_START_HOUR + i) * 60,
);
const MAX_DAYS = 12;

type Quote = {
  operator: CabOperator;
  cab: CabOperator["cabs"][number];
  breakdown: ReturnType<typeof fareBreakdown>;
};

export default function CabSearch({ operators }: { operators: CabOperator[] }) {
  const router = useRouter();

  const [days, setDays] = useState(1);

  // Fixed at first render — dates don't move mid-session, and pinning it keeps
  // the day rail and the pickup-date state from disagreeing on a midnight tick.
  const firstDay = useMemo(() => addDays(todayIST(), 1), []);
  const dayChips = useMemo(
    () => Array.from({ length: 14 }, (_, i) => addDays(firstDay, i)),
    [firstDay],
  );
  const [pickDateKey, setPickDateKey] = useState(dayKey(firstDay));
  const [pickupMins, setPickupMins] = useState(9 * 60);

  const [pickedCode, setPickedCode] = useState<string | null>(null);
  const [step, setStep] = useState<"search" | "book">("search");
  const [payMode, setPayMode] = useState<CabPayMode>("partial");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // A quote per car, across every operator, for the current day count.
  const quotes: Quote[] = useMemo(() => {
    const out: Quote[] = [];
    for (const operator of operators) {
      for (const cab of operator.cabs) {
        const breakdown = fareBreakdown(cab, { tripType: "fullday", days, pickupMins });
        if (breakdown.totalPaise > 0) out.push({ operator, cab, breakdown });
      }
    }
    return out.sort((a, b) => a.breakdown.totalPaise - b.breakdown.totalPaise);
  }, [operators, days, pickupMins]);

  const picked = quotes.find((q) => q.cab.code === pickedCode) ?? null;

  const submit = async () => {
    if (!picked || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await ensureSession();

      // Every cab booking now collects money online — the whole fare, or at
      // least this operator's own commission with the rest owed to the
      // driver (073/137).
      const split = cabPaymentSplit(picked.breakdown.totalPaise, payMode, picked.operator.commissionBps);
      const razorpay = await chargeViaRazorpay({
        amountPaise: split.paidNowPaise,
        receipt: makeReceipt(`cab-${picked.operator.slug}-${picked.cab.code}`),
        description: `${picked.cab.model} — ${picked.operator.name}`,
      });

      const result = await bookCab({
        operator: picked.operator.slug,
        cab: picked.cab.code,
        tripType: "fullday",
        fromPlaceId: null,
        toPlaceId: null,
        startsAt: instantIso(pickDateKey, pickupMins),
        returnDate: null,
        days,
        pickupNote: note,
        payMode,
        razorpay,
      });
      if (!result.ok) {
        setProblem(result.message);
        setBusy(false);
        return;
      }
      const q = new URLSearchParams({
        type: "cab",
        id: picked.operator.slug,
        cab: picked.cab.code,
        tt: "fullday",
        pd: pickDateKey,
        pt: String(pickupMins),
        pay: payMode,
        ref: result.ref,
        days: String(days),
      });
      router.push(`/booked?${q.toString()}`);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Something went wrong.");
      setBusy(false);
    }
  };

  // ---- Book step -----------------------------------------------------------
  if (step === "book" && picked) {
    const total = picked.breakdown.totalPaise;
    const split = cabPaymentSplit(total, payMode, picked.operator.commissionBps);
    return (
      <main className="page-flow pt-6 pb-36">
        <button
          type="button"
          onClick={() => setStep("search")}
          className="flex items-center gap-1.5 text-[13px] font-bold text-muted"
        >
          <BackIcon size={14} />
          Cars
        </button>

        <h1 className="font-display mt-3 text-[20px] font-bold tracking-tight">
          {picked.cab.model}
        </h1>
        <p className="mt-0.5 text-[12.5px] font-medium text-muted">
          {picked.operator.name} · Full day hire
        </p>

        <div className="mt-5 flex flex-col gap-2 rounded-[18px] border border-line bg-surface p-4 text-[13.5px]">
          <Line label="Days" value={`${days} ${days === 1 ? "day" : "days"}`} />
          <Line
            label="Pickup"
            value={`${fmtDateLabel(new Date(`${pickDateKey}T00:00:00Z`))}, ${fmtClock(pickupMins)}`}
          />
        </div>

        <div className="mt-3 flex flex-col gap-1.5 rounded-[18px] border border-line bg-surface p-4 text-[13.5px]">
          <Line label="Base fare" value={rupees(picked.breakdown.basePaise)} />
          {picked.breakdown.nightPaise > 0 && (
            <Line label="Night pickup" value={rupees(picked.breakdown.nightPaise)} />
          )}
          <div className="mt-1 flex justify-between border-t border-hairline pt-2 text-[16px] font-bold">
            <span>Total fare</span>
            <span>{rupees(total)}</span>
          </div>
        </div>
        <p className="mt-2 text-[11.5px] font-medium text-muted">
          {picked.cab.meta ||
            "Extra kilometres or hours beyond the day's allowance are agreed with the driver directly."}
        </p>

        <div className="mt-4 flex flex-col gap-2">
          <PayOption
            on={payMode === "partial"}
            onClick={() => setPayMode("partial")}
            title={`Pay ${rupees(
              cabPaymentSplit(total, "partial", picked.operator.commissionBps).paidNowPaise,
            )} now`}
            sub={`${rupees(
              cabPaymentSplit(total, "partial", picked.operator.commissionBps).balancePaise,
            )} to the driver on the day`}
          />
          <PayOption
            on={payMode === "full"}
            onClick={() => setPayMode("full")}
            title={`Pay ${rupees(total)} now`}
            sub="Nothing to pay the driver"
          />
        </div>

        <div className="mt-3 flex flex-col gap-1.5 rounded-[18px] border border-line bg-surface p-4 text-[13.5px]">
          <Line label="Pay Andaman Go online now" value={rupees(split.paidNowPaise)} />
          <Line label="Pay the driver on the day" value={rupees(split.balancePaise)} />
        </div>
        <p className="mt-2 text-[11.5px] font-medium text-muted">
          The rest of the fare is paid directly to the driver.
        </p>

        <label className="mt-4 flex flex-col gap-1.5">
          <span className="text-[12px] font-bold text-muted">
            Anything the driver should know (optional)
          </span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Flight number, hotel name, extra luggage…"
            className="rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[14px] font-medium outline-none focus:border-brand"
          />
        </label>

        {problem && (
          <p className="mt-3 rounded-xl border border-sandline bg-sandsoft px-3.5 py-2.5 text-[12.5px] leading-relaxed font-medium text-sandink2">
            {problem}
          </p>
        )}

        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface">
          <div className="page-flow flex items-center gap-3.5 pt-3.5 pb-[max(1.5rem,calc(var(--safe-bottom)+0.5rem))]">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] font-semibold text-muted">Pay now</p>
              <p className="mt-0.5 text-[19px] font-bold tracking-tight">
                {rupees(split.paidNowPaise)}
              </p>
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

  // ---- Search step --------------------------------------------------------
  return (
    <>
      <div className="bg-brand text-white">
        <div className="page-flow pt-6 pb-5 lg:pt-10 lg:pb-6">
          <div className="flex items-center gap-3">
            <PageBack href="/explore" />
            <h1 className="font-display text-[19px] lg:text-page font-bold tracking-tight">Full day hire</h1>
          </div>
          <p className="mt-2 text-[12.5px] font-medium text-white/85">
            An operator&apos;s own car for the whole day, at their own rate.
          </p>
        </div>
      </div>

      <main className="page-flow pt-4 pb-36">
        <div className="flex items-center justify-between rounded-[15px] border border-line bg-surface px-4 py-2.5">
          <span className="text-[14px] font-semibold">How many days?</span>
          <div className="flex items-center gap-3.5">
            <button
              type="button"
              aria-label="Fewer days"
              onClick={() => setDays((d) => Math.max(1, d - 1))}
              className="h-11 w-11 rounded-xl border border-line bg-ground text-lg font-bold text-brand"
            >
              −
            </button>
            <span className="w-5 text-center text-[17px] font-bold">{days}</span>
            <button
              type="button"
              aria-label="More days"
              onClick={() => setDays((d) => Math.min(MAX_DAYS, d + 1))}
              className="h-11 w-11 rounded-xl bg-brand text-lg font-bold text-white"
            >
              +
            </button>
          </div>
        </div>

        <h2 className="mt-5 text-[12px] font-bold tracking-wider text-muted uppercase">
          Pickup date
        </h2>
        <div className="no-bar mt-2.5 flex gap-2 overflow-x-auto pb-1 lg:flex-wrap lg:overflow-visible">
          {dayChips.map((d) => {
            const key = dayKey(d);
            const on = key === pickDateKey;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={on}
                onClick={() => setPickDateKey(key)}
                className={`flex h-[62px] w-[64px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-2xl border text-sm ${
                  on ? "border-brand bg-brand text-white" : "border-line bg-surface"
                }`}
              >
                <span className="text-[11px] opacity-75">
                  {d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })}
                </span>
                <span className="text-[16px] font-bold">{d.getUTCDate()}</span>
              </button>
            );
          })}
        </div>

        <h2 className="mt-5 text-[12px] font-bold tracking-wider text-muted uppercase">
          Pickup time
        </h2>
        <div className="mt-2.5 grid grid-cols-4 gap-2">
          {PICKUP_TIMES.map((m) => {
            const on = m === pickupMins;
            return (
              <button
                key={m}
                type="button"
                aria-pressed={on}
                onClick={() => setPickupMins(m)}
                className={`h-10 rounded-xl border text-[12px] font-bold ${
                  on ? "border-brand bg-brand text-white" : "border-line bg-surface"
                }`}
              >
                {fmtClock(m)}
              </button>
            );
          })}
        </div>
        {isNightPickup(pickupMins) && (
          <p className="mt-2 text-[11.5px] font-semibold text-muted">
            Night pickup — a night charge may be added by the operator.
          </p>
        )}

        <h2 className="mt-6 text-[12px] font-bold tracking-wider text-muted uppercase">
          {quotes.length} {quotes.length === 1 ? "car" : "cars"}
        </h2>

        {quotes.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-line bg-surface p-5 text-center text-[13px] leading-relaxed font-medium text-muted">
            No operator has set a full-day rate yet.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2.5">
            {quotes.map((q) => {
              const on = q.cab.code === pickedCode;
              return (
                <li key={`${q.operator.slug}-${q.cab.code}`}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => setPickedCode(q.cab.code)}
                    className={`flex w-full items-center gap-3.5 rounded-[18px] border bg-surface p-3.5 text-left transition ${
                      on ? "border-brand shadow-md" : "border-line"
                    }`}
                  >
                    {q.cab.photos.length > 0 ? (
                      <span className="relative h-[52px] w-[52px] shrink-0 overflow-hidden rounded-[13px] border border-line bg-ground">
                        <Image
                          src={q.cab.photos[0]}
                          alt=""
                          fill
                          sizes="52px"
                          loading="lazy"
                          className="object-cover"
                        />
                      </span>
                    ) : (
                      <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-[13px] bg-brandsoft text-brand">
                        <CarIcon size={26} />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14.5px] font-bold">{q.cab.model}</span>
                      <span className="mt-0.5 block truncate text-[11.5px] font-medium text-muted">
                        {CATEGORY_LABEL[q.cab.category]} · {q.cab.seats} seats ·{" "}
                        {FUEL_LABEL[q.cab.fuel]}
                        {q.cab.ac ? " · AC" : ""}
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] font-semibold text-muted">
                        {q.operator.name}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-[16px] font-bold text-brand">
                        {rupees(q.breakdown.totalPaise)}
                      </span>
                      <span className="block text-[10.5px] font-semibold text-muted">
                        {days}-day
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </main>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface">
        <div className="page-flow flex items-center gap-3.5 pt-3.5 pb-[max(1.5rem,calc(var(--safe-bottom)+0.5rem))]">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] font-semibold text-muted">
              {picked ? `${picked.cab.model} · ${picked.operator.name}` : "Pick a car to continue"}
            </p>
            <p className="mt-0.5 text-[19px] font-bold tracking-tight">
              {picked ? rupees(picked.breakdown.totalPaise) : "—"}
            </p>
          </div>
          <button
            type="button"
            disabled={!picked}
            onClick={() => setStep("book")}
            className={`flex h-13 shrink-0 items-center gap-2 rounded-2xl px-6 py-3.5 text-[15px] font-bold ${
              picked ? "bg-brand text-white" : "bg-ground text-muted"
            }`}
          >
            Continue
            <ChevronIcon size={18} />
          </button>
        </div>
      </div>
    </>
  );
}

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
      <span className="min-w-0">
        <span className="block text-[13.5px] font-bold">{title}</span>
        <span className="block text-[11.5px] font-medium text-muted">{sub}</span>
      </span>
    </button>
  );
}
