// How many places are already taken, for anything that can be booked.
//
// Seats left is capacity minus this. The counts live in their own table rather
// than being counted out of bookings on every read, for one reason: a visitor
// who is not signed in has to be able to see "3 seats left" without being able
// to read anybody's booking. This table holds numbers and nothing else.
//
// Every module that shows availability goes through here, so the awkward part —
// lining up a calendar day and a time-of-day with a timestamp in the database —
// is written once and got right once.

import { dayKey, instantIso } from "./date";
import { supabase, unwrap } from "./supabase";

// Stays (like cabs) never write to this generic `availability` counter —
// their peak-load check reads booking_items directly (create_stay_booking,
// 097), same as cabs and rentals — so 'stay' is deliberately not in this list.
export type AvailKind =
  | "activity"
  | "ferry"
  | "event"
  | "rental"
  | "trip";

/** Places taken, keyed by subject and the exact moment it starts. */
export type Taken = Map<string, number>;

/**
 * The precise moment something starts, in milliseconds.
 *
 * Both sides of every lookup go through this function. A slot knows a calendar
 * day and a time of day; the database knows an instant. Converting in one
 * direction only, in one place, is what stops "9:00 AM on the 26th" and the
 * timestamp that means the same thing from failing to match.
 */
export function instantOf(date: Date, timeMins: number): number {
  return new Date(instantIso(dayKey(date), timeMins)).getTime();
}

/** Everything taken for one kind of thing, between two days. */
export async function takenFor(kind: AvailKind, from: Date, to: Date): Promise<Taken> {
  const rows = unwrap(
    await supabase
      .from("availability")
      .select("subject_id, starts_at, taken")
      .eq("kind", kind)
      .gte("starts_at", from.toISOString())
      .lt("starts_at", to.toISOString()),
    `${kind} availability`,
  ) as { subject_id: string; starts_at: string; taken: number }[];

  const map: Taken = new Map();
  for (const row of rows) {
    map.set(`${row.subject_id}|${new Date(row.starts_at).getTime()}`, row.taken);
  }
  return map;
}

/** How many places are gone for one thing at one moment. None means none. */
export function takenAt(
  taken: Taken,
  subjectId: string,
  date: Date,
  timeMins: number,
): number {
  return taken.get(`${subjectId}|${instantOf(date, timeMins)}`) ?? 0;
}
