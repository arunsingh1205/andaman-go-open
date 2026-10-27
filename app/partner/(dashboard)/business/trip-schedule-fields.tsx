"use client";

// The "Runs on" editor for a day trip, shared by the new-trip form
// (business/new/trip) and the edit form (business/edit/trip/[id]) — which are
// otherwise mirrors of each other.
//
// A trip runs one of two ways:
//   * "weekly"  — a weekly recurrence, the Sun–Sat bar (all seven = daily).
//   * "dates"   — a list of one-off calendar dates (a charter, a festival day).
// Either way it leaves at one pickup time.
//
// The database keeps this as trips.run_dates (empty => weekly) and
// trips.departs_mins — see supabase/074-trip-schedule-times.sql. This component
// is controlled: the parent owns the `schedule` object.

import { CloseIcon, PlusIcon } from "@/app/icons";
import { minsToTime, timeToMins } from "@/app/partner/(dashboard)/business/activity-schedule-fields";

const WEEKDAYS = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

export type TripSchedule = {
  mode: "weekly" | "dates";
  /** weekly mode — 0 (Sun) … 6 (Sat) */
  daysOfWeek: number[];
  /** dates mode — "yyyy-mm-dd" */
  dates: string[];
  /** pickup time, "HH:MM" */
  departTime: string;
  /** Approximate return time, "HH:MM" — optional, descriptive only. */
  endTime: string;
};

/** Tomorrow in the browser's local date, as "yyyy-mm-dd" — the earliest date a
 *  one-off run may be set to (today's trip has effectively left). */
export function tomorrowKey(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toLocaleDateString("en-CA");
}

export function emptyTripSchedule(): TripSchedule {
  return { mode: "weekly", daysOfWeek: [...EVERY_DAY], dates: [], departTime: "09:00", endTime: "" };
}

export function tripScheduleFromTrip(t: {
  runsOnDays: number[];
  runDates: string[];
  departsMins: number;
  endsMins: number | null;
}): TripSchedule {
  const dates = t.runDates ?? [];
  return {
    mode: dates.length > 0 ? "dates" : "weekly",
    daysOfWeek: dates.length > 0 ? [...EVERY_DAY] : t.runsOnDays,
    dates: [...dates].sort(),
    departTime: minsToTime(t.departsMins ?? 360),
    endTime: t.endsMins != null ? minsToTime(t.endsMins) : "",
  };
}

export function tripScheduleValid(s: TripSchedule): boolean {
  if (!/^\d{2}:\d{2}$/.test(s.departTime)) return false;
  if (s.endTime !== "" && !/^\d{2}:\d{2}$/.test(s.endTime)) return false;
  if (s.mode === "weekly") return s.daysOfWeek.length > 0;
  const clean = s.dates.filter((d) => d !== "");
  if (clean.length === 0) return false;
  if (new Set(clean).size !== clean.length) return false;
  const min = tomorrowKey();
  return clean.every((d) => d >= min);
}

/** The columns the add/update RPC (and lib/partner-register) expect. */
export function tripScheduleToArgs(s: TripSchedule): {
  runsOnDays: number[];
  runDates: string[];
  departsMins: number;
  endsMins: number | null;
} {
  const departsMins = timeToMins(s.departTime);
  const endsMins = s.endTime === "" ? null : timeToMins(s.endTime);
  if (s.mode === "dates") {
    return {
      runsOnDays: [...EVERY_DAY],
      runDates: [...new Set(s.dates.filter((d) => d !== ""))].sort(),
      departsMins,
      endsMins,
    };
  }
  return { runsOnDays: [...s.daysOfWeek].sort((a, b) => a - b), runDates: [], departsMins, endsMins };
}

const inputClass =
  "h-12 w-full min-w-0 rounded-xl border border-line bg-surface px-3.5 text-[15px] font-semibold outline-none focus:border-brand";
const labelText = "text-[12px] font-bold text-muted";

export default function TripScheduleFields({
  schedule,
  onChange,
}: {
  schedule: TripSchedule;
  onChange: (next: TripSchedule) => void;
}) {
  const set = (patch: Partial<TripSchedule>) => onChange({ ...schedule, ...patch });

  const toggleDay = (day: number) =>
    set({
      daysOfWeek: schedule.daysOfWeek.includes(day)
        ? schedule.daysOfWeek.filter((d) => d !== day)
        : [...schedule.daysOfWeek, day].sort((a, b) => a - b),
    });

  // The row list always shows at least one date input; schedule.dates itself
  // may still be empty (nothing entered yet), so every edit works off `dates`,
  // not schedule.dates, or the first keystroke would map over [] and vanish.
  const dates = schedule.dates.length > 0 ? schedule.dates : [""];

  const setDate = (i: number, value: string) =>
    set({ dates: dates.map((d, n) => (n === i ? value : d)) });

  const addDate = () => set({ dates: [...dates, ""] });

  const removeDate = (i: number) => set({ dates: dates.filter((_, n) => n !== i) });

  const hasDuplicateDate =
    new Set(schedule.dates.filter((d) => d !== "")).size !==
    schedule.dates.filter((d) => d !== "").length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <span className={labelText}>Runs on</span>
        <div className="flex gap-1.5">
          {(
            [
              ["weekly", "Every week"],
              ["dates", "Specific dates"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => set({ mode: value })}
              className={`h-9 flex-1 rounded-lg px-3 text-[12.5px] font-bold ${
                schedule.mode === value ? "bg-brand text-white" : "border border-line bg-surface text-muted"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {schedule.mode === "weekly" ? (
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAYS.map((d) => (
            <button
              key={d.value}
              type="button"
              onClick={() => toggleDay(d.value)}
              className={`h-9 rounded-lg px-3 text-[12.5px] font-bold ${
                schedule.daysOfWeek.includes(d.value)
                  ? "bg-brand text-white"
                  : "border border-line bg-surface text-muted"
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {dates.map((value, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="date"
                min={tomorrowKey()}
                value={value}
                onChange={(e) => setDate(i, e.target.value)}
                className={`${inputClass} flex-1`}
              />
              {schedule.dates.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeDate(i)}
                  aria-label="Remove this date"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line text-muted"
                >
                  <CloseIcon size={14} />
                </button>
              )}
            </div>
          ))}
          {hasDuplicateDate && (
            <p className="text-[12px] font-medium text-warn">Two dates are the same — remove one.</p>
          )}
          <button
            type="button"
            onClick={addDate}
            className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-dashed border-line text-[12.5px] font-bold text-muted"
          >
            <PlusIcon size={12} />
            Add another date
          </button>
        </div>
      )}

      <div className="flex gap-3">
        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className={labelText}>Pickup time</span>
          <input
            type="time"
            value={schedule.departTime}
            onChange={(e) => set({ departTime: e.target.value })}
            className={inputClass}
          />
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className={labelText}>Approx. return time — optional</span>
          <input
            type="time"
            value={schedule.endTime}
            onChange={(e) => set({ endTime: e.target.value })}
            className={inputClass}
          />
        </label>
      </div>
    </div>
  );
}
