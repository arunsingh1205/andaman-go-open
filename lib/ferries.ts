// Ferries — read from Supabase.
//
// The timetable is a template, same as activities: one row per sailing, with a
// departure time and the days it runs. Seat counts come from availability, so
// "Only 9 seats left" is now a fact rather than a sentence somebody typed.

import { addDays, dayKey, fmtDayLabel, fmtDayNum, fmtMonth, todayIST } from "./date";
import { takenAt, takenFor } from "./availability";
import { galleriesFor } from "./listing-photos";
import { supabase, unwrap } from "./supabase";

/**
 * Ferry booking, paused at the traveller app's front door (2026-10-09) —
 * there's no live operator API yet (every booking still gets placed by hand
 * with Makruzz/Nautika/Green Ocean, lib/admin-bookings.ts
 * placeFerryBooking), and with demand running high right now that manual
 * step can't keep up. Nothing about ferries is removed: the booking flow,
 * the admin placement queue, and travellers' existing ferry bookings all
 * keep working exactly as before — this one flag just stops new ones from
 * starting. Flip back to true once there's a real way to guarantee a seat
 * at the moment of booking.
 */
export const FERRY_BOOKING_ENABLED = false;

export type Sailing = {
  id: string;
  operator: string;
  tag: string;
  tagTone: "good" | "warm" | "plain";
  depMins: number;
  durationMins: number;
  farePaise: number;
  note: string;
  noteWarn: boolean;
  /** Seats free on tomorrow's crossing — the count the search opens on. */
  seatsLeft: number;
  /** Partner-uploaded photos, cover first — empty until a partner adds any (037). */
  photos: string[];
  /** The route this sailing runs — island slugs and the names travellers use. */
  fromSlug: string;
  toSlug: string;
  fromName: string;
  toName: string;
};

export type DayChip = { key: string; label: string; num: string; month: string };

/** A route the search can offer, derived from the sailings that exist. */
export type Route = { fromSlug: string; toSlug: string; fromName: string; toName: string };

/** The distinct routes present in a sailing list, ordered by island sort. */
export function routesOf(sailings: Sailing[]): Route[] {
  const seen = new Map<string, Route>();
  for (const s of sailings) {
    const key = `${s.fromSlug}>${s.toSlug}`;
    if (!seen.has(key)) {
      seen.set(key, {
        fromSlug: s.fromSlug,
        toSlug: s.toSlug,
        fromName: s.fromName,
        toName: s.toName,
      });
    }
  }
  return [...seen.values()];
}

/** Below this many seats we stop being polite about it. */
const LOW_SEATS = 10;

// This app books on the traveller's behalf, and near-term crossings often
// show no seats left with the operator by the time the booking is actually
// placed — so the search doesn't offer today or tomorrow at all, only dates
// starting a few days out.
/** Nearest a sailing can be booked, in days from today. */
const MIN_DAYS_AHEAD = 3;
/** How many days past that minimum the search still offers dates for. */
const DAYS_WINDOW = 30;

type Row = {
  id: string;
  code: string;
  style_label: string;
  style_tone: "good" | "warm" | "plain";
  dep_mins: number;
  duration_mins: number;
  fare_paise: number;
  capacity: number;
  info: string;
  info_warn: boolean;
  from_island: string;
  to_island: string;
  partners: { name: string } | null;
};

const SELECT = `
  id, code, style_label, style_tone, dep_mins, duration_mins, fare_paise,
  capacity, info, info_warn, from_island, to_island,
  partners!inner ( name )
`;

export async function getSailings(): Promise<Sailing[]> {
  const rows = (await supabase
    .from("sailings")
    .select(SELECT)
    .eq("is_listed", true)
    .order("dep_mins")
    .then((r) => unwrap(r, "sailings"))) as unknown as Row[];

  // Seats are shown for tomorrow, which is the day the search opens on.
  const day = addDays(todayIST(), 1);
  const taken = await takenFor("ferry", day, addDays(day, 1));
  const galleries = await galleriesFor("ferry", rows.map((r) => r.id));
  const islandName = await getIslandNames();

  // "Cheapest" and "Fastest" are claims about one route's options, not the
  // whole network — a short Havelock–Neil hop shouldn't wear the badge on the
  // Port Blair–Neil list. So the minimums are worked out per route.
  const routeKey = (r: Row) => `${r.from_island}>${r.to_island}`;
  const cheapestOn = new Map<string, number>();
  const fastestOn = new Map<string, number>();
  for (const r of rows) {
    const k = routeKey(r);
    cheapestOn.set(k, Math.min(cheapestOn.get(k) ?? Infinity, r.fare_paise));
    fastestOn.set(k, Math.min(fastestOn.get(k) ?? Infinity, r.duration_mins));
  }

  return rows.map((row) => {
    const seatsLeft = Math.max(
      0,
      row.capacity - takenAt(taken, row.id, day, row.dep_mins),
    );

    // The badge is worked out from this sailing's own numbers, so editing a
    // fare in the database moves "Cheapest" with it.
    const tag =
      row.fare_paise === cheapestOn.get(routeKey(row))
        ? { label: "Cheapest", tone: "good" as const }
        : row.duration_mins === fastestOn.get(routeKey(row))
          ? { label: "Fastest", tone: "good" as const }
          : { label: row.style_label, tone: row.style_tone };

    const note =
      seatsLeft <= LOW_SEATS
        ? {
            text: `Only ${seatsLeft} seat${seatsLeft === 1 ? "" : "s"} left`,
            warn: true,
          }
        : { text: row.info, warn: row.info_warn };

    return {
      id: row.code,
      operator: row.partners?.name ?? "Unknown operator",
      tag: tag.label,
      tagTone: tag.tone,
      depMins: row.dep_mins,
      durationMins: row.duration_mins,
      farePaise: row.fare_paise,
      note: note.text,
      noteWarn: note.warn,
      seatsLeft,
      photos: galleries.get(row.id) ?? [],
      fromSlug: row.from_island,
      toSlug: row.to_island,
      fromName: islandName.get(row.from_island) ?? row.from_island,
      toName: islandName.get(row.to_island) ?? row.to_island,
    };
  });
}

/** slug -> the name travellers use, for every island a sailing might touch. */
async function getIslandNames(): Promise<Map<string, string>> {
  const rows = (await supabase
    .from("islands")
    .select("slug, name")
    .then((r) => unwrap(r, "islands"))) as { slug: string; name: string }[];
  return new Map(rows.map((r) => [r.slug, r.name]));
}

export async function getDays(): Promise<DayChip[]> {
  const days: DayChip[] = [];
  const today = todayIST();

  for (let i = MIN_DAYS_AHEAD; i <= MIN_DAYS_AHEAD + DAYS_WINDOW; i++) {
    const d = addDays(today, i);
    days.push({ key: dayKey(d), label: fmtDayLabel(d), num: fmtDayNum(d), month: fmtMonth(d) });
  }
  return days;
}

// One clock formatter for the whole app now — see lib/date.ts for why.
export { fmtClock as fmtTime } from "./date";

export function fmtDuration(mins: number) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
