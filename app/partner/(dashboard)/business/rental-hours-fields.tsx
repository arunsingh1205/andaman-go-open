"use client";

// Pick-up hours for a rental shop (rental_hours) — one row per weekday,
// unchanged in storage (035). The only change here is the entry UX: a
// day-range preset toolbar ("Every day" / "Weekdays" / "Weekends") that
// opens every day in the chosen range with one shared time in a single
// click — rather than requiring the partner to tick and fill in up to seven
// separate weekday rows — while the per-day rows below stay editable for the
// exception case (a different Sunday hour, say).
//
// "Every day" is the default when nothing is open yet, matching the same
// convention as the day-range picker used for restaurant hours and an
// activity's window rows.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setRentalHours, type RentalHour } from "@/lib/partner-register";

const DOW_LABEL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const PRESETS: { label: string; days: number[] }[] = [
  { label: "Every day", days: [0, 1, 2, 3, 4, 5, 6] },
  { label: "Weekdays", days: [1, 2, 3, 4, 5] },
  { label: "Weekends", days: [0, 6] },
];

function toClock(mins: number): string {
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}
function toMins(clock: string): number {
  const [h, m] = clock.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

type DayRow = { open: boolean; openMins: number; closeMins: number };

export default function RentalHoursEditor({ initial }: { initial: RentalHour[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<DayRow[]>(() =>
    Array.from({ length: 7 }, (_, dow) => {
      const found = initial.find((h) => h.dow === dow);
      return found
        ? { open: true, openMins: found.openMins, closeMins: found.closeMins }
        : { open: false, openMins: 9 * 60, closeMins: 18 * 60 };
    }),
  );
  const [presetOpen, setPresetOpen] = useState("09:00");
  const [presetClose, setPresetClose] = useState("18:00");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const set = (dow: number, patch: Partial<DayRow>) => {
    setRows((r) => r.map((d, i) => (i === dow ? { ...d, ...patch } : d)));
    setSaved(false);
  };

  const applyPreset = (days: number[]) => {
    const openMins = toMins(presetOpen);
    const closeMins = toMins(presetClose);
    setRows((r) =>
      r.map((d, dow) => (days.includes(dow) ? { open: true, openMins, closeMins } : { ...d, open: false })),
    );
    setSaved(false);
  };

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const hours: RentalHour[] = rows
      .map((d, dow) => ({ dow, openMins: d.openMins, closeMins: d.closeMins, open: d.open }))
      .filter((d) => d.open)
      .map(({ dow, openMins, closeMins }) => ({ dow, openMins, closeMins }));

    if (hours.length === 0) {
      setProblem("Open at least one day.");
      setBusy(false);
      return;
    }
    if (hours.some((h) => h.openMins >= h.closeMins)) {
      setProblem("Each open day needs an opening time before its closing time.");
      setBusy(false);
      return;
    }

    const result = await setRentalHours(hours);
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    setSaved(true);
    router.refresh();
  };

  return (
    <section className="mt-5 border-t border-hairline pt-4">
      <p className="text-[12px] font-bold text-muted">Pick-up hours</p>
      <p className="mt-0.5 text-[11.5px] font-medium text-muted">
        When travellers can collect a vehicle. A booking outside these hours is turned away.
      </p>

      <div className="mt-2.5 rounded-xl border border-dashed border-line p-2.5">
        <p className="text-[11px] font-bold text-muted uppercase">Quick set</p>
        <div className="mt-1.5 flex items-center gap-1.5 text-[12px] font-semibold">
          <input
            type="time"
            value={presetOpen}
            onChange={(e) => setPresetOpen(e.target.value)}
            className="rounded-lg border border-line bg-ground px-2 py-1"
          />
          <span className="text-muted">to</span>
          <input
            type="time"
            value={presetClose}
            onChange={(e) => setPresetClose(e.target.value)}
            className="rounded-lg border border-line bg-ground px-2 py-1"
          />
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => applyPreset(p.days)}
              className="h-8 rounded-full border border-line bg-surface px-3 text-[11.5px] font-bold text-muted"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-2.5 flex flex-col gap-1.5">
        {rows.map((d, dow) => (
          <div key={dow} className="flex items-center gap-2.5 rounded-xl border border-line bg-surface p-2.5">
            <label className="flex w-[92px] shrink-0 items-center gap-2 text-[12px] font-bold">
              <input
                type="checkbox"
                checked={d.open}
                onChange={(e) => set(dow, { open: e.target.checked })}
              />
              {DOW_LABEL[dow].slice(0, 3)}
            </label>
            {d.open ? (
              <div className="flex items-center gap-1.5 text-[12px] font-semibold">
                <input
                  type="time"
                  value={toClock(d.openMins)}
                  onChange={(e) => set(dow, { openMins: toMins(e.target.value) })}
                  className="rounded-lg border border-line bg-ground px-2 py-1"
                />
                <span className="text-muted">to</span>
                <input
                  type="time"
                  value={toClock(d.closeMins)}
                  onChange={(e) => set(dow, { closeMins: toMins(e.target.value) })}
                  className="rounded-lg border border-line bg-ground px-2 py-1"
                />
              </div>
            ) : (
              <span className="text-[12px] font-medium text-muted">Closed</span>
            )}
          </div>
        ))}
      </div>
      {problem && <p className="mt-2 text-[11.5px] font-medium text-warn">{problem}</p>}
      <button
        type="button"
        disabled={busy}
        onClick={save}
        className="mt-3 h-11 w-full rounded-xl bg-brand text-[13px] font-bold text-white disabled:opacity-60"
      >
        {busy ? "Saving…" : saved ? "Saved ✓" : "Save pick-up hours"}
      </button>
    </section>
  );
}
