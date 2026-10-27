// Dates a partner has closed — read side.
//
// A closure (021-listing-closures.sql) is "this listing is shut on this
// date, here's why". The catalogue reads it the same way it reads seat
// counts: one windowed lookup per kind, then a Map keyed by
// "subjectId|YYYY-MM-DD" so expanding a timetable into days is a cheap
// in-memory check.
//
// Public table, so this uses the plain catalogue client like the rest of
// lib/*, not the per-user server client.

import { dayKey } from "./date";
import { supabase, unwrap } from "./supabase";

export type ClosureKind = "activity" | "trip";

/** "subjectId|YYYY-MM-DD" -> reason, for one kind over a date window. */
export type Closures = Map<string, string>;

export async function closuresFor(
  kind: ClosureKind,
  from: Date,
  to: Date,
): Promise<Closures> {
  const rows = unwrap(
    await supabase
      .from("listing_closures")
      .select("subject_id, on_date, reason")
      .eq("kind", kind)
      .gte("on_date", dayKey(from))
      .lte("on_date", dayKey(to)),
    `${kind} closures`,
  ) as { subject_id: string; on_date: string; reason: string }[];

  const map: Closures = new Map();
  for (const row of rows) {
    map.set(`${row.subject_id}|${row.on_date}`, row.reason);
  }
  return map;
}

/** The closure reason for one subject on one day, or null if it's open. */
export function closureOn(
  closures: Closures,
  subjectId: string,
  dayKeyStr: string,
): string | null {
  return closures.get(`${subjectId}|${dayKeyStr}`) ?? null;
}
