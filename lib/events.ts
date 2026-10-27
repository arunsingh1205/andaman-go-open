// Events — read from Supabase.
//
// Most events happen once, on a date — the common case, and still the whole
// story for a row with an empty recur_days. One can also repeat on a
// weekday pattern through an end date (157: events.recur_days/recur_until),
// for a residency or a festival month that would otherwise need one listing
// per night. This module expands a recurring row into one EventItem per
// matching date within the window below, same id and slug throughout — the
// traveller picks which night from the detail page's date chips, and that
// choice travels as a `?date=` query param since the slug alone can no
// longer pin down which occurrence.
//
// The day chips are built from the dates events actually fall on (recurring
// rows included, post-expansion), rather than a fixed window. That is why
// the empty fourth chip is gone: there was never anything on that day.

import { addDays, BOOKING_CUTOFF_HOURS, dayKey as fmtDayKey, fmtClock, fmtDayLabel, fmtDayNum, fmtMonth, instantIso, isPastCutoff, todayIST } from "./date";
import { takenAt, takenFor } from "./availability";
import { galleriesFor } from "./listing-photos";
import { supabase, unwrap } from "./supabase";

export type Genre =
  | "dj"
  | "live"
  | "bonfire"
  | "karaoke"
  | "comedy"
  | "drama"
  | "festival"
  | "carnival"
  | "cruise";
export type AgeRestriction = "all-ages" | "18+" | "21+";

/** One kind of pass an event sells — Single, Couple, Group of 5, and so on (153). */
export type EventTicket = {
  id: string;
  name: string;
  description: string;
  pricePaise: number;
  /** How many people one of these lets in. */
  people: number;
};

export type EventItem = {
  slug: string;
  genre: Genre;
  mark: string;
  name: string;
  venue: string;
  area: string;
  dayKey: string;
  dayLabel: string;
  dayNum: string;
  timeLabel: string;
  /** The exact instant it starts. */
  startsAt: string;
  /** Set when the partner gave an approximate end time — descriptive only. */
  endTimeLabel: string | null;
  /** The cheapest way in — the one price when there are no ticket types. */
  entryPaise: number;
  /** Passes on sale. Empty means the old single per-head entry price (153). */
  tickets: EventTicket[];
  /** Null means uncapped — the partner hasn't set a limit. Counts people, not passes. */
  capacity: number | null;
  going: number;
  rating: string;
  reviews: number;
  about: string;
  /** Door policy — every event states one (053). */
  ageRestriction: AgeRestriction;
  /** Who's playing — set for 'dj' and 'live', null for 'bonfire' and 'karaoke' (053). */
  performer: string | null;
  /** Partner-set Google Maps pin for this venue — null until they add one (071). */
  mapsUrl: string | null;
  /** Partner-uploaded photos, cover first — empty until a partner adds any (037). */
  photos: string[];
  /** True when this row repeats (157) — recur_days is non-empty. */
  isRecurring: boolean;
  /** "Every night until 31 Oct" / "Every Fri, Sat until 30 Nov" — null for a
   *  one-off event. Descriptive only; create_booking (157) is what actually
   *  enforces the pattern. */
  recurringLabel: string | null;
};

export type DayChip = { key: string; label: string; num: string; month: string };

export const GENRE_LABEL: Record<Genre, string> = {
  dj: "DJ set",
  live: "Live music",
  bonfire: "Bonfire",
  karaoke: "Karaoke",
  comedy: "Comedy",
  drama: "Theatre",
  festival: "Festival",
  carnival: "Carnival",
  cruise: "Dinner cruise",
};

export const AGE_RESTRICTION_LABEL: Record<AgeRestriction, string> = {
  "all-ages": "All ages",
  "18+": "18+",
  "21+": "21+",
};

/** Kids this age and under don't need a ticket — free, and don't count
 *  against capacity. Everyone older needs one; the RSVP form (053) works out
 *  how many tickets that is before it ever calls create_booking. */
export const FREE_UNDER_AGE = 3;

/** How far ahead the Events screen looks. */
const DAYS_AHEAD = 14;

type Row = {
  id: string;
  slug: string;
  genre: Genre;
  mark: string;
  name: string;
  venue: string;
  area: string;
  on_date: string;
  time_mins: number;
  end_time_mins: number | null;
  entry_paise: number;
  capacity: number | null;
  rating: number | string;
  reviews: number;
  about: string;
  age_restriction: AgeRestriction;
  performer: string | null;
  maps_url: string | null;
  recur_days: number[];
  recur_until: string | null;
};

const SELECT = `
  id, slug, genre, mark, name, venue, area, on_date, time_mins, end_time_mins,
  entry_paise, capacity, rating, reviews, about, age_restriction, performer, maps_url,
  recur_days, recur_until
`;

/** A date column comes back as "2026-08-26"; turn it into a day marker. */
const asDate = (onDate: string) => new Date(`${onDate}T00:00:00Z`);

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function recurringLabel(recurDays: number[], recurUntil: string | null): string | null {
  if (recurDays.length === 0 || !recurUntil) return null;
  const until = asDate(recurUntil);
  const untilLabel = `${fmtDayNum(until)} ${fmtMonth(until)}`;
  if (recurDays.length === 7) return `Every night until ${untilLabel}`;
  const days = [...recurDays].sort((a, b) => a - b).map((d) => WEEKDAY_SHORT[d]).join(", ");
  return `Every ${days} until ${untilLabel}`;
}

/** Every date within [from, to] (inclusive) whose weekday is in `days`,
 *  as "yyyy-mm-dd" keys — the dates a recurring row's matching nights fall
 *  on, bounded by the window the read is for either side. */
function matchingDates(days: number[], from: Date, to: Date): string[] {
  const out: string[] = [];
  let d = from;
  while (d.getTime() <= to.getTime()) {
    if (days.includes(d.getUTCDay())) out.push(fmtDayKey(d));
    d = addDays(d, 1);
  }
  return out;
}

async function ticketsFor(eventIds: string[]): Promise<Map<string, EventTicket[]>> {
  const byEvent = new Map<string, EventTicket[]>();
  if (eventIds.length === 0) return byEvent;

  const rows = (await supabase
    .from("event_tickets")
    .select("id, event_id, name, description, price_paise, people")
    .in("event_id", eventIds)
    .order("sort_order")
    .then((r) => unwrap(r, "event tickets"))) as unknown as {
    id: string;
    event_id: string;
    name: string;
    description: string;
    price_paise: number;
    people: number;
  }[];

  for (const r of rows) {
    const list = byEvent.get(r.event_id) ?? [];
    list.push({ id: r.id, name: r.name, description: r.description, pricePaise: r.price_paise, people: r.people });
    byEvent.set(r.event_id, list);
  }
  return byEvent;
}

async function load(filter?: { slug?: string; islandSlug?: string }): Promise<EventItem[]> {
  const today = todayIST();
  const horizon = addDays(today, DAYS_AHEAD);
  const todayKey = fmtDayKey(today);
  const horizonKey = fmtDayKey(horizon);

  // A recurring row's own on_date can be in the past (a residency that
  // started last month and is still running) — gte("on_date", today) alone
  // would wrongly drop it. A row counts if it starts within the window, OR
  // it's still recurring through at least today.
  let query = supabase
    .from("events")
    .select(SELECT)
    .eq("is_listed", true)
    .lte("on_date", horizonKey)
    .or(`on_date.gte.${todayKey},recur_until.gte.${todayKey}`);

  if (filter?.slug) query = query.eq("slug", filter.slug);
  if (filter?.islandSlug) query = query.eq("island_slug", filter.islandSlug);

  const [rows, taken] = await Promise.all([
    query
      .order("on_date")
      .order("time_mins")
      .then((r) => unwrap(r, "events") as unknown as Row[]),
    takenFor("event", today, addDays(horizon, 1)),
  ]);

  const galleries = await galleriesFor("event", rows.map((r) => r.id));
  const ticketsByEvent = await ticketsFor(rows.map((r) => r.id));

  const items: EventItem[] = [];

  for (const row of rows) {
    const label = recurringLabel(row.recur_days, row.recur_until);
    let dates: string[];

    if (row.recur_days.length === 0) {
      // Already guaranteed on_date is within [todayKey, horizonKey] by the
      // query above — a one-off event, exactly as before 157.
      dates = [row.on_date];
    } else {
      const fromKey = row.on_date > todayKey ? row.on_date : todayKey;
      const untilKey = row.recur_until ?? row.on_date;
      const toKey = untilKey < horizonKey ? untilKey : horizonKey;
      dates = matchingDates(row.recur_days, asDate(fromKey), asDate(toKey));
    }

    for (const dateKey of dates) {
      if (isPastCutoff(instantIso(dateKey, row.time_mins), BOOKING_CUTOFF_HOURS)) continue;

      const date = asDate(dateKey);
      const takenCount = takenAt(taken, row.id, date, row.time_mins);
      const going = row.capacity == null ? takenCount : Math.min(takenCount, row.capacity);
      items.push({
        slug: row.slug,
        genre: row.genre,
        mark: row.mark,
        name: row.name,
        venue: row.venue,
        area: row.area,
        dayKey: dateKey,
        dayLabel: fmtDayLabel(date),
        dayNum: fmtDayNum(date),
        timeLabel: fmtClock(row.time_mins),
        startsAt: instantIso(dateKey, row.time_mins),
        endTimeLabel: row.end_time_mins != null ? fmtClock(row.end_time_mins) : null,
        entryPaise: row.entry_paise,
        tickets: ticketsByEvent.get(row.id) ?? [],
        capacity: row.capacity,
        ageRestriction: row.age_restriction,
        performer: row.performer,
        mapsUrl: row.maps_url,
        going,
        rating: String(row.rating),
        reviews: row.reviews,
        about: row.about,
        photos: galleries.get(row.id) ?? [],
        isRecurring: row.recur_days.length > 0,
        recurringLabel: label,
      });
    }
  }

  items.sort((a, b) => (a.dayKey === b.dayKey ? a.startsAt.localeCompare(b.startsAt) : a.dayKey.localeCompare(b.dayKey)));
  return items;
}

export async function getEvents(islandSlug?: string): Promise<EventItem[]> {
  return load(islandSlug ? { islandSlug } : undefined);
}

/** Every upcoming night one specific event is on, within the window — what
 *  the detail page's date picker offers (157). */
export async function getEventOccurrences(slug: string): Promise<EventItem[]> {
  return load({ slug });
}

/** One specific night of an event — `dateKey` picks which (from the date
 *  picker, or a shared `?date=` link); omitted or not found falls back to
 *  the soonest upcoming one. */
export async function getEvent(slug: string, dateKey?: string): Promise<EventItem | undefined> {
  const items = await load({ slug });
  if (dateKey) return items.find((e) => e.dayKey === dateKey) ?? items[0];
  return items[0];
}

/** One chip per day that actually has something on it. */
export async function getDays(islandSlug?: string): Promise<DayChip[]> {
  // Reuses load()'s own expansion rather than a second, simpler query — a
  // recurring event's nights (157) don't exist as distinct on_date rows in
  // the table, only load() knows which dates they actually fall on.
  const items = await load(islandSlug ? { islandSlug } : undefined);

  const seen = new Set<string>();
  const days: DayChip[] = [];

  for (const e of items) {
    if (seen.has(e.dayKey)) continue;
    seen.add(e.dayKey);
    days.push({ key: e.dayKey, label: e.dayLabel, num: e.dayNum, month: fmtMonth(asDate(e.dayKey)) });
  }

  days.sort((a, b) => a.key.localeCompare(b.key));
  return days;
}

export function seatsLeft(e: EventItem) {
  return e.capacity == null ? Infinity : Math.max(0, e.capacity - e.going);
}
