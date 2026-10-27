"use client";

// The timetable editor for an activity (activity_schedule), shared by two
// screens: the standalone "Hours" editor (business/schedule/activity/[id])
// and the "Add an activity" form (business/new/activity). A new activity
// carries its times straight from that form, so admin can approve it without
// a round-trip back to the partner asking for hours (038's approval guard).
//
// Since 090, an activity has two schedule modes:
//   - "window" (the default for a new activity): a row is an availability
//     range — travellers pick any time inside it, snapped to 30 minutes.
//     No per-slot "closed" toggle here; a range doesn't map onto one.
//   - "fixed": today's original shape — one row per exact departure time,
//     each with its own "temporarily closed" toggle.
// Both shapes share one row type (`endTime` empty means a fixed instant,
// set means a window's end) so the same component and slot-conversion
// helpers serve either mode; only which fields are shown differs.
//
// The component is controlled: the parent owns the `rows` array and the
// helpers here (validation, the slot shape the set_partner_activity_schedule
// RPC wants) work off it.

import { CloseIcon, PlusIcon } from "@/app/icons";

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

export type ScheduleMode = "window" | "fixed";

export type ActivityRow = {
  key: number;
  time: string;
  /** Empty means a fixed, exact departure time. Set means a window's end. */
  endTime: string;
  /** Empty means uncapped. */
  capacity: string;
  daysOfWeek: number[];
  closed: boolean;
  closedReason: string;
};

export function timeToMins(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function minsToTime(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function nextKey(rows: ActivityRow[]): number {
  return rows.reduce((max, r) => Math.max(max, r.key), -1) + 1;
}

export function newActivityRow(key = 0, mode: ScheduleMode = "window"): ActivityRow {
  return {
    key,
    time: "09:00",
    endTime: mode === "window" ? "17:00" : "",
    capacity: "",
    daysOfWeek: [...EVERY_DAY],
    closed: false,
    closedReason: "",
  };
}

/** The initial rows for the editor: what's already saved, or one blank row
 *  (shaped for the given mode) when the activity has no timetable yet. */
export function activityRowsFromSlots(
  slots: {
    timeMins: number;
    endTimeMins: number | null;
    capacity: number | null;
    daysOfWeek: number[];
    closedReason: string | null;
  }[],
  mode: ScheduleMode = "window",
): ActivityRow[] {
  if (slots.length === 0) return [newActivityRow(0, mode)];
  return slots.map((s, i) => ({
    key: i,
    time: minsToTime(s.timeMins),
    endTime: s.endTimeMins != null ? minsToTime(s.endTimeMins) : "",
    capacity: s.capacity == null ? "" : String(s.capacity),
    daysOfWeek: s.daysOfWeek,
    closed: s.closedReason !== null,
    closedReason: s.closedReason ?? "",
  }));
}

export function activityRowsToSlots(rows: ActivityRow[]) {
  return rows.map((r) => ({
    timeMins: timeToMins(r.time),
    endTimeMins: r.endTime.trim() === "" ? null : timeToMins(r.endTime),
    capacity: r.capacity.trim() === "" ? null : parseInt(r.capacity, 10),
    daysOfWeek: r.daysOfWeek,
    closedReason: r.closed ? r.closedReason.trim() : null,
  }));
}

export function activityRowsHaveDuplicateTime(rows: ActivityRow[]): boolean {
  const times = rows.map((r) => timeToMins(r.time));
  return new Set(times).size !== times.length;
}

export function activityRowsValid(rows: ActivityRow[]): boolean {
  if (rows.length === 0 || activityRowsHaveDuplicateTime(rows)) return false;
  return rows.every((r) => {
    const capText = r.capacity.trim();
    const cap = parseInt(capText, 10);
    const capOk = capText === "" || (!isNaN(cap) && cap >= 1);
    const endOk = r.endTime.trim() === "" || timeToMins(r.endTime) > timeToMins(r.time);
    return capOk && endOk && r.daysOfWeek.length > 0 && (!r.closed || r.closedReason.trim() !== "");
  });
}

const inputClass =
  "h-11 w-full min-w-0 rounded-xl border border-line bg-surface px-3 text-[14px] font-semibold outline-none focus:border-brand";
const labelText = "text-[11.5px] font-bold text-muted";

export default function ActivityScheduleFields({
  rows,
  onChange,
  mode = "window",
}: {
  rows: ActivityRow[];
  onChange: (rows: ActivityRow[]) => void;
  mode?: ScheduleMode;
}) {
  const updateRow = (key: number, patch: Partial<ActivityRow>) => {
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const toggleDay = (key: number, day: number) => {
    onChange(
      rows.map((r) =>
        r.key === key
          ? {
              ...r,
              daysOfWeek: r.daysOfWeek.includes(day)
                ? r.daysOfWeek.filter((d) => d !== day)
                : [...r.daysOfWeek, day].sort((a, b) => a - b),
            }
          : r,
      ),
    );
  };

  const addRow = () => onChange([...rows, newActivityRow(nextKey(rows), mode)]);

  const removeRow = (key: number) => {
    if (rows.length > 1) onChange(rows.filter((r) => r.key !== key));
  };

  const hasDuplicateTime = activityRowsHaveDuplicateTime(rows);
  const isWindow = mode === "window";

  return (
    <div className="flex flex-col gap-4">
      {rows.map((row, i) => (
        <div key={row.key} className="rounded-xl border border-line bg-surface p-3.5">
          <div className="flex items-center justify-between">
            <span className="text-[11.5px] font-bold text-muted">
              {isWindow ? `Window ${i + 1}` : `Slot ${i + 1}`}
            </span>
            {rows.length > 1 && (
              <button
                type="button"
                onClick={() => removeRow(row.key)}
                aria-label={isWindow ? "Remove this window" : "Remove this slot"}
                className="text-muted"
              >
                <CloseIcon size={14} />
              </button>
            )}
          </div>

          <div className="mt-2 flex gap-3">
            <label className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className={labelText}>{isWindow ? "Available from" : "Departure time"}</span>
              <input
                type="time"
                value={row.time}
                onChange={(e) => updateRow(row.key, { time: e.target.value })}
                className={inputClass}
              />
            </label>
            {isWindow && (
              <label className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className={labelText}>Until</span>
                <input
                  type="time"
                  value={row.endTime}
                  onChange={(e) => updateRow(row.key, { endTime: e.target.value })}
                  className={inputClass}
                />
              </label>
            )}
          </div>

          <label className="mt-2 flex flex-col gap-1.5">
            <span className={labelText}>Capacity (people) — optional</span>
            <input
              type="number"
              inputMode="numeric"
              value={row.capacity}
              onChange={(e) => updateRow(row.key, { capacity: e.target.value })}
              placeholder="Leave blank for no limit"
              className={inputClass}
            />
          </label>

          <div className="mt-2.5 flex flex-col gap-1.5">
            <span className={labelText}>Runs on</span>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((d) => (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => toggleDay(row.key, d.value)}
                  className={`h-8 rounded-lg px-2.5 text-[12px] font-bold ${
                    row.daysOfWeek.includes(d.value) ? "bg-brand text-white" : "border border-line bg-surface text-muted"
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          {!isWindow && (
            <>
              <label className="mt-2.5 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={row.closed}
                  onChange={(e) => updateRow(row.key, { closed: e.target.checked })}
                  className="h-4 w-4"
                />
                <span className="text-[12px] font-semibold text-ink">Temporarily closed</span>
              </label>
              {row.closed && (
                <input
                  value={row.closedReason}
                  onChange={(e) => updateRow(row.key, { closedReason: e.target.value })}
                  placeholder="Sea too rough this week"
                  className={`${inputClass} mt-1.5 w-full`}
                />
              )}
            </>
          )}
        </div>
      ))}

      {hasDuplicateTime && (
        <p className="text-[12px] font-medium text-warn">
          Two {isWindow ? "windows start" : "slots have"} at the same time — give each one a different
          start time.
        </p>
      )}

      <button
        type="button"
        onClick={addRow}
        className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-dashed border-line text-[12.5px] font-bold text-muted"
      >
        <PlusIcon size={12} />
        {isWindow ? "Add another window" : "Add another time"}
      </button>
    </div>
  );
}
