"use client";

// A reusable "opening hours" row editor: an open/close time and which
// weekdays it applies to, with quick presets for a day range ("Mon–Sat") on
// top of a manual per-day toggle bar. Shared by rental-shop hours,
// restaurant hours, and an activity's window rows (090) — all three are the
// same underlying shape: a start time, an end time, which weekdays it runs.
//
// "Every day" is the default for a new row, not a range the partner has to
// notice and pick — plenty of shops and activities run all seven days, so a
// partner who does nothing gets a correct 7-day-a-week listing. The presets
// exist to make the *exception* ("closed Sundays", "weekdays only") fast to
// enter, not to make all-7-days harder to reach.

import { CloseIcon, PlusIcon } from "@/app/icons";
import { timeToMins } from "./activity-schedule-fields";

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
const PRESETS: { label: string; days: number[] }[] = [
  { label: "Every day", days: EVERY_DAY },
  { label: "Weekdays", days: [1, 2, 3, 4, 5] },
  { label: "Weekends", days: [0, 6] },
];

function sameDays(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort().join(",");
  const sb = [...b].sort().join(",");
  return sa === sb;
}

/** The "which days does this run" block — day-range presets over a manual
 *  per-day toggle bar. Standalone so a caller with its own row shape (e.g.
 *  restaurant sittings, which also carry a seats-per-table figure) can use
 *  it without adopting HoursRow wholesale. */
export function DayPresetPicker({
  daysOfWeek,
  onChange,
}: {
  daysOfWeek: number[];
  onChange: (days: number[]) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className={labelText}>Days</span>
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => onChange([...p.days])}
            className={`h-8 rounded-full px-3 text-[11.5px] font-bold ${
              sameDays(daysOfWeek, p.days) ? "bg-brand text-white" : "border border-line bg-surface text-muted"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {WEEKDAYS.map((d) => (
          <button
            key={d.value}
            type="button"
            onClick={() =>
              onChange(
                daysOfWeek.includes(d.value)
                  ? daysOfWeek.filter((x) => x !== d.value)
                  : [...daysOfWeek, d.value].sort((a, b) => a - b),
              )
            }
            className={`h-8 rounded-lg px-2.5 text-[12px] font-bold ${
              daysOfWeek.includes(d.value) ? "bg-brand text-white" : "border border-line bg-surface text-muted"
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export type HoursRow = {
  key: number;
  openTime: string;
  closeTime: string;
  daysOfWeek: number[];
  /** Only shown when the caller renders capacity. Empty means uncapped. */
  capacity: string;
};

export function newHoursRow(key = 0): HoursRow {
  return { key, openTime: "09:00", closeTime: "18:00", daysOfWeek: [...EVERY_DAY], capacity: "" };
}

function nextKey(rows: HoursRow[]): number {
  return rows.reduce((max, r) => Math.max(max, r.key), -1) + 1;
}

export function hoursRowsValid(rows: HoursRow[]): boolean {
  if (rows.length === 0) return false;
  return rows.every((r) => {
    const capText = r.capacity.trim();
    const cap = parseInt(capText, 10);
    const capOk = capText === "" || (!isNaN(cap) && cap >= 1);
    return timeToMins(r.openTime) < timeToMins(r.closeTime) && r.daysOfWeek.length > 0 && capOk;
  });
}

const inputClass =
  "h-11 w-full min-w-0 rounded-xl border border-line bg-surface px-3 text-[14px] font-semibold outline-none focus:border-brand";
const labelText = "text-[11.5px] font-bold text-muted";

export default function DayRangeHoursFields({
  rows,
  onChange,
  rowNoun = "period",
  capacityLabel,
  capacityPlaceholder = "Leave blank for no limit",
}: {
  rows: HoursRow[];
  onChange: (rows: HoursRow[]) => void;
  /** What one row is called in the "Add another…" button and remove label. */
  rowNoun?: string;
  /** Pass a label to show the optional capacity field on each row; omit to hide it entirely. */
  capacityLabel?: string;
  capacityPlaceholder?: string;
}) {
  const updateRow = (key: number, patch: Partial<HoursRow>) => {
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const addRow = () => onChange([...rows, newHoursRow(nextKey(rows))]);
  const removeRow = (key: number) => {
    if (rows.length > 1) onChange(rows.filter((r) => r.key !== key));
  };

  return (
    <div className="flex flex-col gap-4">
      {rows.map((row, i) => (
        <div key={row.key} className="rounded-xl border border-line bg-surface p-3.5">
          <div className="flex items-center justify-between">
            <span className="text-[11.5px] font-bold text-muted">
              {rows.length > 1 ? `${rowNoun.charAt(0).toUpperCase()}${rowNoun.slice(1)} ${i + 1}` : "Hours"}
            </span>
            {rows.length > 1 && (
              <button
                type="button"
                onClick={() => removeRow(row.key)}
                aria-label={`Remove this ${rowNoun}`}
                className="text-muted"
              >
                <CloseIcon size={14} />
              </button>
            )}
          </div>

          <div className="mt-2 flex gap-3">
            <label className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className={labelText}>Open from</span>
              <input
                type="time"
                value={row.openTime}
                onChange={(e) => updateRow(row.key, { openTime: e.target.value })}
                className={inputClass}
              />
            </label>
            <label className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className={labelText}>Until</span>
              <input
                type="time"
                value={row.closeTime}
                onChange={(e) => updateRow(row.key, { closeTime: e.target.value })}
                className={inputClass}
              />
            </label>
          </div>

          {capacityLabel && (
            <label className="mt-2 flex flex-col gap-1.5">
              <span className={labelText}>{capacityLabel}</span>
              <input
                type="number"
                inputMode="numeric"
                value={row.capacity}
                onChange={(e) => updateRow(row.key, { capacity: e.target.value })}
                placeholder={capacityPlaceholder}
                className={inputClass}
              />
            </label>
          )}

          <div className="mt-2.5">
            <DayPresetPicker
              daysOfWeek={row.daysOfWeek}
              onChange={(days) => updateRow(row.key, { daysOfWeek: days })}
            />
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={addRow}
        className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-dashed border-line text-[12.5px] font-bold text-muted"
      >
        <PlusIcon size={12} />
        Add another {rowNoun}
      </button>
    </div>
  );
}
