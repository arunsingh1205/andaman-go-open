const IST = "Asia/Kolkata";

// "Today" in IST, expressed as a UTC-midnight Date so day math (setUTCDate etc.)
// stays timezone-safe regardless of the host server's local clock.
export function todayIST(): Date {
  const parts = new Date().toLocaleDateString("en-CA", { timeZone: IST }); // YYYY-MM-DD
  return new Date(`${parts}T00:00:00Z`);
}

export function addDays(d: Date, days: number): Date {
  const copy = new Date(d);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

// Formatters below always pin timeZone: "UTC" — the Date is a calendar-day
// marker (UTC midnight of an IST day), not a real instant, so formatting it
// in the host's local zone could roll it back a day.
export function fmtDayLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
}

export function fmtDayNum(d: Date): string {
  return String(d.getUTCDate());
}

export function fmtDateLabel(d: Date): string {
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export function fmtMonth(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
}

export function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Minutes from midnight to a clock face: 390 -> "6:30 AM".
 *
 * Built by arithmetic rather than toLocaleTimeString on purpose. The locale
 * version gives "6:30 am" under en-IN and "6:30 AM" under en-US, so the same
 * app was showing two different casings depending on which module formatted
 * the time — and which one you got was decided by the host's data, not by any
 * code you could read. This always returns the same string everywhere.
 */
export function fmtClock(minsFromMidnight: number): string {
  const total = ((minsFromMidnight % 1440) + 1440) % 1440;
  const h24 = Math.floor(total / 60);
  const m = total % 60;
  const suffix = h24 < 12 ? "AM" : "PM";
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${String(m).padStart(2, "0")} ${suffix}`;
}

/**
 * The exact instant something starts, as an ISO string.
 *
 * A screen knows "the 26th" and "8:00 AM in minutes". A booking is recorded
 * against a moment. This is the only place that conversion happens, so a slot
 * and the row it creates can never disagree about what time it was.
 */
export function instantIso(dayKey: string, timeMins: number): string {
  const hh = String(Math.floor(timeMins / 60)).padStart(2, "0");
  const mm = String(timeMins % 60).padStart(2, "0");
  return new Date(`${dayKey}T${hh}:${mm}:00+05:30`).toISOString();
}

/**
 * How far ahead of its own start time a booking closes and disappears from
 * the app — every timed category (activities, ferries, events, trips, rental
 * pick-up) shares this one window, cab and stays excepted since neither books
 * against a fixed slot the way these do.
 */
export const BOOKING_CUTOFF_HOURS = 2;

/**
 * True once fewer than `hoursBefore` hours remain before `startsAtIso`.
 *
 * Used to close (and hide) a booking a fixed window ahead of its start — see
 * BOOKING_CUTOFF_HOURS above for who uses it and why.
 */
export function isPastCutoff(startsAtIso: string, hoursBefore: number): boolean {
  return new Date(startsAtIso).getTime() - hoursBefore * 3_600_000 <= Date.now();
}
