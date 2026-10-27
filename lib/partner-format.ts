// Small formatting helpers shared by every partner-facing list — bookings,
// check-in results, delivered history. Split out so the same "what day is
// this, in words" logic isn't copied a third time as the partner app grows.

import { addDays, dayKey, fmtDateLabel } from "./date";
import type { BookingKind } from "./bookings";

/** Minutes from midnight IST for an instant — the app shows island time. */
export function istMinutes(iso: string): number {
  const parts = new Date(iso).toLocaleTimeString("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const [h, m] = parts.split(":").map(Number);
  return h * 60 + m;
}

/** The IST calendar day an instant falls on, as YYYY-MM-DD. */
export function istDayKey(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/** The IST calendar month an instant falls in, as YYYY-MM — for "this month" totals. */
export function istMonthKey(iso: string): string {
  return istDayKey(iso).slice(0, 7);
}

/** "2 guests", "3 nights · 2 guests", "3 seats" — the same fact, said the
 *  right way. `units` is only meaningful (and only ever passed) for a stay. */
export function partyLabel(kind: BookingKind, party: number, units?: number): string {
  if (kind === "stay" && units != null) {
    return `${units} ${units === 1 ? "night" : "nights"} · ${party} ${party === 1 ? "guest" : "guests"}`;
  }
  if (kind === "ferry") return `${party} ${party === 1 ? "adult" : "adults"}`;
  if (kind === "trip") return `${party} ${party === 1 ? "seat" : "seats"}`;
  return `${party} ${party === 1 ? "guest" : "guests"}`;
}

/** "3 Sep · 4:32 PM" in island time — for timelines and message timestamps. */
export function istStampLabel(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-US", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
  });
  const time = d.toLocaleTimeString("en-US", {
    timeZone: "Asia/Kolkata",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${date} · ${time}`;
}

/** "Today", "Tomorrow", "Thursday", or a date once it is further out. */
export function dateLabelFor(iso: string, today: Date): string {
  const onDate = istDayKey(iso);
  if (onDate === dayKey(today)) return "Today";
  if (onDate === dayKey(addDays(today, 1))) return "Tomorrow";

  const date = new Date(`${onDate}T00:00:00Z`);
  const daysOut = Math.round((date.getTime() - today.getTime()) / 86400000);

  if (daysOut > 1 && daysOut < 7) {
    return date.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  }
  if (daysOut === -1) return "Yesterday";
  return fmtDateLabel(date);
}
