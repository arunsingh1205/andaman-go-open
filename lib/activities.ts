// Activities — now read from Supabase.
//
// Nothing about the shape of what this module returns has changed. The screens
// still call getActivities() and getActivity(slug) and still get an Activity
// with a slots array. That was the point of the seam: the database swap
// happens entirely inside this file.
//
// The one idea worth understanding is how a timetable becomes slots. The
// database does not hold "9 AM on the 26th". It holds "we run at 9 AM, these
// days of the week, six people" — one row per departure time. This file
// expands that into today plus the next six days when it reads, which is
// exactly what the old hardcoded TIMES array did, just with the numbers
// coming from a partner rather than from me. Today's own slots are then
// trimmed by the same 2-hour cutoff every timed category uses (lib/date.ts
// BOOKING_CUTOFF_HOURS), so a 9 AM dive stops being offered by 7 AM rather
// than sitting there bookable, unrunnable, for the rest of the day.

import { addDays, BOOKING_CUTOFF_HOURS, fmtClock, fmtDayLabel, fmtDayNum, fmtMonth, isPastCutoff, dayKey as toDayKey, todayIST } from "./date";
import { instantOf, takenAt, takenFor, type Taken } from "./availability";
import { closureOn, closuresFor, type Closures } from "./listing-closures";
import { galleriesFor } from "./listing-photos";
import { paymentModeFor, type PaymentMode } from "./payments";
import { supabase, unwrap } from "./supabase";

export type Slot = {
  id: string;
  dayKey: string;
  dayLabel: string;
  dayNum: string;
  month: string;
  timeLabel: string;
  /** The exact instant it starts, ISO. What a booking is recorded against. */
  startsAt: string;
  /** Null means uncapped — the partner hasn't set a limit. */
  capacity: number | null;
  booked: number;
  isOpen: boolean;
  /** Why it is shut, when it is. "Sea too rough" is now a partner's words. */
  closedReason: string | null;
};

export type Activity = {
  slug: string;
  category: "scuba" | "seawalk" | "snorkel" | "water" | "stargazing";
  mark: string;
  name: string;
  operator: string;
  /** Where it actually is — the listing's own area if the partner set one
   *  (127), else the shop/operator's own area, else null when neither is
   *  set yet. Lets a traveller compare cards by "which is nearby" before
   *  opening either one. */
  area: string | null;
  summary: string;
  about: string;
  pricePaise: number;
  rating: string;
  reviews: number;
  slots: Slot[];
  /** Partner-uploaded photos, cover first — empty until a partner adds any (037). */
  photos: string[];
  /** Whether this category takes a deposit or the full price (034). */
  paymentMode: PaymentMode;
  /** This operator's own agreed commission, in basis points (138) — what a
   *  deposit actually collects online now. */
  commissionBps: number | null;
};

/** How many days ahead the booking grid shows, past today (day 0). */
const DAYS_AHEAD = 6;

// The shape Supabase hands back. Written out rather than inferred so that a
// column rename shows up here as a type error instead of as undefined on screen.
type ScheduleRow = {
  time_mins: number;
  /** Set on a window row (090) — travellers pick any 30-min-aligned time up
   *  to and including this. Null means a fixed, exact departure time. */
  end_time_mins: number | null;
  capacity: number | null;
  days_of_week: number[];
  closed_reason: string | null;
};

type ActivityRow = {
  id: string;
  slug: string;
  category: Activity["category"];
  mark: string;
  name: string;
  summary: string;
  about: string;
  price_paise: number;
  rating: number | string;
  reviews: number;
  area: string | null;
  partners: { name: string; credential: string | null; area: string | null; commission_bps: number | null } | null;
  activity_schedule: ScheduleRow[];
};

const SELECT = `
  id, slug, category, mark, name, summary, about, price_paise, rating, reviews, area,
  partners!inner ( name, credential, area, commission_bps ),
  activity_schedule ( time_mins, end_time_mins, capacity, days_of_week, closed_reason )
`;

/**
 * The bookable instants a schedule row stands for. A fixed row (end_time_mins
 * null) is just its own time. A window row generates one instant every 30
 * minutes from time_mins through end_time_mins inclusive — the same
 * increment the booking screen offers travellers.
 */
function timesFor(entry: ScheduleRow): number[] {
  if (entry.end_time_mins == null) return [entry.time_mins];
  const times: number[] = [];
  for (let m = entry.time_mins; m <= entry.end_time_mins; m += 30) times.push(m);
  return times;
}

/**
 * Turns one activity row plus its timetable into the days the app shows.
 * `taken` maps "this activity at this exact moment" to how many places have
 * gone, so a slot with no bookings simply has no row and reads as empty.
 */
function expand(row: ActivityRow, taken: Taken, closures: Closures): Slot[] {
  const slots: Slot[] = [];
  const today = todayIST();

  const timetable = [...row.activity_schedule].sort((a, b) => a.time_mins - b.time_mins);

  // Day 0 is today: a slot later this afternoon is worth showing even if
  // this morning's already gone. The per-slot cutoff below is what actually
  // drops the ones that have (or are about to).
  for (let day = 0; day <= DAYS_AHEAD; day++) {
    const date = addDays(today, day);
    // A date the operator has closed (021) beats the timetable's own
    // per-slot closed_reason — it's the more specific, more current fact.
    const dateClosed = closureOn(closures, row.id, toDayKey(date));

    for (const entry of timetable) {
      if (!entry.days_of_week.includes(date.getUTCDay())) continue;

      for (const timeMins of timesFor(entry)) {
        const startsAt = new Date(instantOf(date, timeMins)).toISOString();
        if (isPastCutoff(startsAt, BOOKING_CUTOFF_HOURS)) continue;

        const takenCount = takenAt(taken, row.id, date, timeMins);
        const booked = entry.capacity == null ? takenCount : Math.min(takenCount, entry.capacity);

        slots.push({
          id: `${row.slug}-d${day}-t${timeMins}`,
          dayKey: toDayKey(date),
          dayLabel: fmtDayLabel(date),
          dayNum: fmtDayNum(date),
          month: fmtMonth(date),
          timeLabel: fmtClock(timeMins),
          startsAt,
          capacity: entry.capacity,
          booked,
          isOpen: dateClosed === null && entry.closed_reason === null,
          closedReason: dateClosed ?? entry.closed_reason,
        });
      }
    }
  }

  return slots;
}

/** Places already gone, across the window the booking grid covers. */
async function activityAvailability(): Promise<Taken> {
  const today = todayIST();
  return takenFor("activity", today, addDays(today, DAYS_AHEAD + 1));
}

/** Dates closed, across the same window. */
async function activityClosures(): Promise<Closures> {
  const today = todayIST();
  return closuresFor("activity", today, addDays(today, DAYS_AHEAD + 1));
}

function toActivity(
  row: ActivityRow,
  taken: Taken,
  closures: Closures,
  paymentMode: PaymentMode,
  photos: string[],
): Activity {
  const partner = row.partners;
  const operator = partner
    ? partner.credential
      ? `${partner.name} · ${partner.credential}`
      : partner.name
    : "Unknown operator";

  return {
    slug: row.slug,
    category: row.category,
    mark: row.mark,
    name: row.name,
    operator,
    area: row.area ?? partner?.area ?? null,
    summary: row.summary,
    about: row.about,
    pricePaise: row.price_paise,
    // Postgres numeric can arrive as a string. The app wants "4.8" either way.
    rating: String(row.rating),
    reviews: row.reviews,
    slots: expand(row, taken, closures),
    photos,
    paymentMode,
    commissionBps: partner?.commission_bps ?? null,
  };
}

export async function getActivities(islandSlug?: string): Promise<Activity[]> {
  let query = supabase.from("activities").select(SELECT).eq("is_listed", true);
  if (islandSlug) query = query.eq("island_slug", islandSlug);

  const [rows, taken, closures, paymentMode] = await Promise.all([
    query.order("slug").then((r) => unwrap(r, "activities") as unknown as ActivityRow[]),
    activityAvailability(),
    activityClosures(),
    paymentModeFor("activity"),
  ]);

  const galleries = await galleriesFor("activity", rows.map((r) => r.id));

  return rows.map((row) => toActivity(row, taken, closures, paymentMode, galleries.get(row.id) ?? []));
}

export async function getActivity(slug: string): Promise<Activity | undefined> {
  const [rows, taken, closures, paymentMode] = await Promise.all([
    supabase
      .from("activities")
      .select(SELECT)
      .eq("is_listed", true)
      .eq("slug", slug)
      .limit(1)
      .then((r) => unwrap(r, `activity "${slug}"`) as unknown as ActivityRow[]),
    activityAvailability(),
    activityClosures(),
    paymentModeFor("activity"),
  ]);

  const row = rows[0];
  if (!row) return undefined;

  const galleries = await galleriesFor("activity", [row.id]);
  return toActivity(row, taken, closures, paymentMode, galleries.get(row.id) ?? []);
}

// ---------------------------------------------------------------------------
// Display helpers. These have nothing to do with the database and are only
// still here because fourteen files import rupees() from this module.
// ---------------------------------------------------------------------------

export function rupees(paise: number) {
  // toLocaleString with no options drops a trailing zero, so a deposit of
  // 31350 paise printed as "₹313.5" - which reads as a rounding bug rather
  // than as money. Whole rupees stay bare (₹1,800), anything with paise in
  // it gets both digits (₹313.50).
  const hasPaise = paise % 100 !== 0;
  return `₹${(paise / 100).toLocaleString("en-IN", {
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

export function seatsLeft(slot: Slot) {
  return slot.capacity == null ? Infinity : Math.max(0, slot.capacity - slot.booked);
}
