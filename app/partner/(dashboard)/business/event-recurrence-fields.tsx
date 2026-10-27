"use client";

// Whether an event happens once, or repeats on a weekday pattern through an
// end date — shared by the new-event and edit-event forms (157).
//
// Unlike a trip's weekly/dates split (trip-schedule-fields.tsx), an event
// already has its own single "Date" field as the series' first night, so
// recurrence here only ever needs "and also repeats on these weekdays,
// until this date" layered on top of it — a start, a weekday pattern, a
// hard end, rather than an open-ended weekly recurrence.

const WEEKDAYS = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];

export const EVERY_NIGHT = [0, 1, 2, 3, 4, 5, 6];

export type EventRecurrence = {
  repeats: boolean;
  /** 0 (Sun)…6 (Sat) — only meaningful while `repeats` is true. */
  days: number[];
  /** "yyyy-mm-dd" — the last night it runs; required while `repeats` is true. */
  until: string;
};

export function emptyEventRecurrence(): EventRecurrence {
  return { repeats: false, days: [...EVERY_NIGHT], until: "" };
}

export function eventRecurrenceFrom(e: { recurDays: number[]; recurUntil: string | null }): EventRecurrence {
  return {
    repeats: e.recurDays.length > 0,
    days: e.recurDays.length > 0 ? e.recurDays : [...EVERY_NIGHT],
    until: e.recurUntil ?? "",
  };
}

export function eventRecurrenceValid(r: EventRecurrence, onDate: string): boolean {
  if (!r.repeats) return true;
  if (r.days.length === 0) return false;
  if (r.until === "" || onDate === "") return false;
  return r.until >= onDate;
}

/** The columns add/update_partner_event and admin_update_event expect. */
export function eventRecurrenceToArgs(r: EventRecurrence): { recurDays: number[]; recurUntil: string | null } {
  if (!r.repeats) return { recurDays: [], recurUntil: null };
  return { recurDays: [...r.days].sort((a, b) => a - b), recurUntil: r.until };
}

const inputClass =
  "h-12 w-full min-w-0 rounded-xl border border-line bg-surface px-3.5 text-[15px] font-semibold outline-none focus:border-brand";
const labelText = "text-[12px] font-bold text-muted";

export default function EventRecurrenceFields({
  recurrence,
  onChange,
  onDate,
}: {
  recurrence: EventRecurrence;
  onChange: (next: EventRecurrence) => void;
  /** The form's own "Date" field — the first night, and the floor for "until". */
  onDate: string;
}) {
  const set = (patch: Partial<EventRecurrence>) => onChange({ ...recurrence, ...patch });

  const toggleDay = (day: number) =>
    set({
      days: recurrence.days.includes(day)
        ? recurrence.days.filter((d) => d !== day)
        : [...recurrence.days, day].sort((a, b) => a - b),
    });

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-ground p-3.5">
      <label className="flex items-center gap-2.5">
        <input
          type="checkbox"
          checked={recurrence.repeats}
          onChange={(e) => set({ repeats: e.target.checked })}
          className="h-5 w-5 accent-brand"
        />
        <span className="text-[13.5px] font-bold">This repeats — not just one night</span>
      </label>
      <p className="-mt-2 text-[11px] leading-relaxed font-medium text-muted">
        One listing instead of a new one for every night — a traveller picks whichever date
        suits them from your pattern.
      </p>

      {recurrence.repeats && (
        <>
          <div className="flex flex-col gap-1.5">
            <span className={labelText}>Repeats on</span>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((d) => (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => toggleDay(d.value)}
                  className={`h-9 rounded-lg px-3 text-[12.5px] font-bold ${
                    recurrence.days.includes(d.value)
                      ? "bg-brand text-white"
                      : "border border-line bg-surface text-muted"
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className={labelText}>Last night</span>
            <input
              type="date"
              min={onDate || undefined}
              value={recurrence.until}
              onChange={(e) => set({ until: e.target.value })}
              className={inputClass}
            />
          </label>
        </>
      )}
    </div>
  );
}
