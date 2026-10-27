"use client";

// Step 2 of the ferry flow. A sailing is picked; now the operator needs every
// passenger by name (as on their photo ID), age, gender, nationality and ID —
// Makruzz / Nautika / Green Ocean all print these on the ticket and check them
// at the jetty. Contact details are collected on /booked, same as every other
// booking.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { bookFerry, type FerryPassenger } from "@/lib/book";
import { ensureSession } from "@/lib/supabase-browser";
import { chargeViaRazorpay, makeReceipt, MIN_CHARGE_PAISE } from "@/lib/razorpay-client";
import { instantIso } from "@/lib/date";
import { fmtTime, fmtDuration, type DayChip, type Sailing } from "@/lib/ferries";
import { rupees } from "@/lib/activities";
import { BackIcon } from "@/app/icons";

type Draft = {
  fullName: string;
  age: string;
  gender: "" | "male" | "female" | "other";
  foreign: boolean;
  country: string;
  idType: "" | "aadhaar" | "driving-licence";
  idNumber: string;
};

const emptyDraft = (): Draft => ({
  fullName: "",
  age: "",
  gender: "",
  foreign: false,
  country: "",
  idType: "",
  idNumber: "",
});

const label = "text-[12px] font-bold text-muted";
const input =
  "h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-[15px] font-semibold outline-none focus:border-brand";

function seg(on: boolean) {
  return `h-10 flex-1 rounded-lg text-[13px] font-bold ${
    on ? "bg-brand text-white" : "border border-line bg-surface text-muted"
  }`;
}

export default function PassengerForm({
  sailing,
  from,
  to,
  day,
  dayKey,
  count,
  onBack,
}: {
  sailing: Sailing;
  from: string;
  to: string;
  day: DayChip;
  dayKey: string;
  count: number;
  onBack: () => void;
}) {
  const router = useRouter();
  const [pax, setPax] = useState<Draft[]>(() =>
    Array.from({ length: count }, emptyDraft),
  );
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const total = sailing.farePaise * count;

  const set = (i: number, patch: Partial<Draft>) =>
    setPax((prev) => prev.map((p, n) => (n === i ? { ...p, ...patch } : p)));

  const ready = pax.every((p) => {
    const age = parseInt(p.age, 10);
    return (
      p.fullName.trim() !== "" &&
      !isNaN(age) &&
      age >= 0 &&
      age <= 120 &&
      p.gender !== "" &&
      p.idNumber.trim() !== "" &&
      (p.foreign ? p.country.trim() !== "" : p.idType !== "")
    );
  });

  const confirm = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setProblem(null);

    const passengers: FerryPassenger[] = pax.map((p) => ({
      fullName: p.fullName.trim(),
      age: parseInt(p.age, 10),
      gender: p.gender as FerryPassenger["gender"],
      nationality: p.foreign ? p.country.trim() : "Indian",
      idType: p.foreign ? "passport" : (p.idType as "aadhaar" | "driving-licence"),
      idNumber: p.idNumber.trim(),
    }));

    try {
      await ensureSession();

      const razorpay =
        total < MIN_CHARGE_PAISE
          ? undefined
          : await chargeViaRazorpay({
              amountPaise: total,
              receipt: makeReceipt(`ferry-${sailing.id}`),
              description: `${from} → ${to}, ${day.label} ${day.num}`,
            });

      const result = await bookFerry({
        kind: "ferry",
        subject: sailing.id,
        startsAt: instantIso(dayKey, sailing.depMins),
        party: count,
        passengers,
        razorpay,
      });

      if (!result.ok) {
        setProblem(result.message);
        setBusy(false);
        return;
      }

      router.push(
        `/booked?type=ferry&id=${sailing.id}&d=${dayKey}&n=${count}&ref=${result.ref}`,
      );
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Something went wrong.");
      setBusy(false);
    }
  };

  return (
    <>
      <div className="sticky top-0 z-30 bg-brand text-white">
        <div className="page-flow pt-[calc(var(--safe-top)+1.5rem)] pb-5 lg:pt-10 lg:pb-6">
          <button
            type="button"
            onClick={onBack}
            className="-ml-2.5 mb-2 flex h-9 items-center gap-1.5 px-2.5 text-[13px] font-bold"
          >
            <BackIcon size={16} />
            Sailings
          </button>
          <h1 className="font-display text-[19px] lg:text-page font-bold tracking-tight">
            Who&apos;s travelling?
          </h1>
          <p className="mt-1 text-[12.5px] font-medium opacity-80">
            {sailing.operator} · {from} → {to} · {day.label} {day.num},{" "}
            {fmtTime(sailing.depMins)} · {fmtDuration(sailing.durationMins)}
          </p>
        </div>
      </div>

      <main className="page-flow pt-4 pb-40">
        <p className="rounded-xl border border-sandline bg-sandsoft px-3.5 py-2.5 text-[12px] leading-relaxed font-medium text-sandink2">
          Each name must match the photo ID that passenger carries to the jetty —
          the operator prints it on the ticket and checks it at boarding. No
          changes once booked.
        </p>

        <div className="mt-4 flex flex-col gap-4">
          {pax.map((p, i) => (
            <div key={i} className="rounded-2xl border border-line bg-surface p-4">
              <p className="text-[13px] font-bold text-brand">Passenger {i + 1}</p>

              <div className="mt-3 flex flex-col gap-3">
                <label className="flex flex-col gap-1.5">
                  <span className={label}>Full name (as on the photo ID)</span>
                  <input
                    value={p.fullName}
                    onChange={(e) => set(i, { fullName: e.target.value })}
                    placeholder="e.g. Arjun Kumar Rao"
                    className={input}
                  />
                </label>

                <div className="flex gap-3">
                  <label className="flex w-24 flex-col gap-1.5">
                    <span className={label}>Age</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      value={p.age}
                      onChange={(e) => set(i, { age: e.target.value })}
                      className={input}
                    />
                  </label>
                  <div className="flex flex-1 flex-col gap-1.5">
                    <span className={label}>Gender</span>
                    <div className="flex gap-1.5">
                      {(["male", "female", "other"] as const).map((g) => (
                        <button
                          key={g}
                          type="button"
                          onClick={() => set(i, { gender: g })}
                          className={`${seg(p.gender === g)} capitalize`}
                        >
                          {g}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className={label}>Nationality</span>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => set(i, { foreign: false })}
                      className={seg(!p.foreign)}
                    >
                      Indian
                    </button>
                    <button
                      type="button"
                      onClick={() => set(i, { foreign: true, idType: "" })}
                      className={seg(p.foreign)}
                    >
                      Foreign national
                    </button>
                  </div>
                </div>

                {p.foreign && (
                  <label className="flex flex-col gap-1.5">
                    <span className={label}>Country</span>
                    <input
                      value={p.country}
                      onChange={(e) => set(i, { country: e.target.value })}
                      placeholder="Country on the passport"
                      className={input}
                    />
                  </label>
                )}

                <div className="flex flex-col gap-1.5">
                  <span className={label}>ID type</span>
                  {p.foreign ? (
                    <p className="rounded-xl border border-line bg-ground px-3.5 py-2.5 text-[13px] font-semibold text-muted">
                      Passport (required for foreign nationals)
                    </p>
                  ) : (
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => set(i, { idType: "aadhaar" })}
                        className={seg(p.idType === "aadhaar")}
                      >
                        Aadhaar
                      </button>
                      <button
                        type="button"
                        onClick={() => set(i, { idType: "driving-licence" })}
                        className={seg(p.idType === "driving-licence")}
                      >
                        Driving licence
                      </button>
                    </div>
                  )}
                </div>

                <label className="flex flex-col gap-1.5">
                  <span className={label}>
                    {p.foreign ? "Passport number" : "ID number"}
                  </span>
                  <input
                    value={p.idNumber}
                    onChange={(e) => set(i, { idNumber: e.target.value })}
                    className={input}
                  />
                </label>
              </div>
            </div>
          ))}
        </div>

        {problem && (
          <p className="mt-4 rounded-xl border border-sandline bg-sandsoft px-3.5 py-2.5 text-[12.5px] leading-relaxed font-medium text-sandink2">
            {problem}
          </p>
        )}
      </main>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface">
        <div className="page-flow flex items-center gap-3.5 pt-3.5 pb-[max(1.5rem,calc(var(--safe-bottom)+0.5rem))]">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold text-muted">
              {count} {count === 1 ? "passenger" : "passengers"} · {rupees(sailing.farePaise)} each
            </p>
            <p className="mt-0.5 text-[19px] font-bold tracking-tight">{rupees(total)}</p>
          </div>
          <button
            type="button"
            disabled={!ready || busy}
            onClick={confirm}
            className={`flex h-13 shrink-0 items-center rounded-2xl px-6 text-[15px] font-bold ${
              ready && !busy ? "bg-brand text-white" : "bg-ground text-muted"
            }`}
          >
            {busy ? "Booking…" : `Pay ${rupees(total)}`}
          </button>
        </div>
      </div>
    </>
  );
}
