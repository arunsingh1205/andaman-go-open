// Trips — read from Supabase.
//
// A trip runs on a recurrence ("Tue, Thu, Sat"), so the database stores which
// days rather than a sentence. "Runs Tue, Thu, Sat" is written here, from that
// list, which means a host changing their days changes the label too.

import { addDays, BOOKING_CUTOFF_HOURS, dayKey, fmtClock, fmtDateLabel, instantIso, isPastCutoff, todayIST } from "./date";
import { paymentModeFor, type PaymentMode } from "./payments";
import { takenAt, takenFor } from "./availability";
import { closureOn, closuresFor } from "./listing-closures";
import { galleriesFor } from "./listing-photos";
import { supabase, unwrap } from "./supabase";

export type Trip = {
  slug: string;
  title: string;
  host: string;
  hostSince: string;
  island: string;
  rating: string;
  reviews: number;
  durationLabel: string;
  nextDateLabel: string;
  /** The host's pickup time, as a clock face — "9:00 AM". */
  departsLabel: string;
  /** The exact instant the next run leaves. */
  startsAt: string;
  /** Approximate return time, as a clock face — set only when the host gave one. */
  endsLabel: string | null;
  pricePaise: number;
  minSeats: number;
  /** Null means uncapped — the host hasn't set a seat limit. */
  seatsTotal: number | null;
  seatsTaken: number;
  summary: string;
  includes: string[];
  /** What to bring, host's own words — comma list, same shape as includes. */
  bringList: string[];
  /** How physical the day is. */
  difficulty: "easy" | "moderate" | "challenging";
  /** The fixed meeting point. Empty string when the host does hotel pickup. */
  meetPoint: string;
  /** True when the host collects each traveller from their accommodation (076). */
  meetAtHotel: boolean;
  /** The host's Google Maps pin for the meeting point, if they gave one (076). */
  mapsUrl: string | null;
  /** False when the host has closed the next run's date — see 021. */
  isOpen: boolean;
  closedReason: string | null;
  /** Partner-uploaded photos, cover first — empty until a partner adds any (037). */
  photos: string[];
  /** Whether the traveller may pay a deposit or must pay in full (034). */
  paymentMode: PaymentMode;
  /** This host's own agreed commission, in basis points (138) — what a
   *  deposit actually collects online now. */
  commissionBps: number | null;
};

// A trip leaves at trips.departs_mins (074). Existing rows default to 360
// (6 AM), which is where every trip booking used to be recorded.
//
// One edge: if a host changes departs_mins after seats were already held at
// the old time, the per-instant seat count below keys off the new time and
// won't see those older holds. Trips are low-volume and the min-seats guard
// tolerates the drift, so we accept it rather than migrate historic rows.

// How far to look for an open run before giving up and showing the soonest
// closed one instead. Also the width of the seat-count / closure lookups.
const RUN_LOOKAHEAD = 21;

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Row = {
  id: string;
  slug: string;
  title: string;
  host_name: string;
  host_since: string;
  duration_label: string;
  runs_on_days: number[];
  run_dates: string[];
  departs_mins: number;
  ends_mins: number | null;
  price_paise: number;
  min_seats: number;
  seats_total: number | null;
  rating: number | string;
  reviews: number;
  summary: string;
  includes: string[];
  bring_list: string[];
  difficulty: "easy" | "moderate" | "challenging";
  meet_point: string;
  meet_at_hotel: boolean;
  maps_url: string | null;
  islands: { name: string } | null;
  partners: { commission_bps: number | null } | null;
};

const SELECT = `
  id, slug, title, host_name, host_since, duration_label, runs_on_days,
  run_dates, departs_mins, ends_mins,
  price_paise, min_seats, seats_total, rating, reviews, summary, includes,
  bring_list, difficulty, meet_point, meet_at_hotel, maps_url,
  islands!inner ( name ),
  partners!inner ( commission_bps )
`;

function dateMarker(key: string): Date {
  return new Date(`${key}T00:00:00Z`);
}

/** "Runs daily" / "Runs Tue, Thu" for a weekly trip, or the upcoming one-off
 *  dates for a trip that runs on specific dates only (074). */
function runsLabel(days: number[], dates: string[], today: Date): string {
  if (dates.length > 0) {
    const upcoming = dates.filter((d) => d > dayKey(today)).sort();
    const show = upcoming.length > 0 ? upcoming : [...dates].sort();
    const labels = show.slice(0, 3).map((d) => fmtDateLabel(dateMarker(d)));
    const extra = show.length - labels.length;
    return `Runs ${labels.join(", ")}${extra > 0 ? ` +${extra} more` : ""}`;
  }
  if (days.length >= 7) return "Runs daily";
  const named = [...days].sort((a, b) => a - b).map((d) => DAY_NAMES[d]);
  return `Runs ${named.join(", ")}`;
}

/**
 * The next day this trip goes out and isn't closed. Today counts as long as
 * its departure is still more than BOOKING_CUTOFF_HOURS away — once that
 * closes, today is skipped exactly like it always was. If every run in the
 * look-ahead window is closed, returns the soonest one anyway with its
 * reason, so the trip page can say why.
 */
function nextRun(
  days: number[],
  dates: string[],
  departsMins: number,
  from: Date,
  closedReason: (d: Date) => string | null,
): { date: Date; closedReason: string | null } {
  const bookable = (d: Date) =>
    !isPastCutoff(instantIso(dayKey(d), departsMins), BOOKING_CUTOFF_HOURS);

  // Specific-date trips (074): the run is one of the listed dates, not a
  // weekly pattern.
  if (dates.length > 0) {
    const upcoming = dates.filter((d) => d >= dayKey(from) && bookable(dateMarker(d))).sort();
    if (upcoming.length === 0) {
      const last = [...dates].sort().pop();
      return {
        date: last ? dateMarker(last) : addDays(from, 1),
        closedReason: "This trip has finished its scheduled dates.",
      };
    }
    for (const key of upcoming) {
      const candidate = dateMarker(key);
      if (closedReason(candidate) === null) return { date: candidate, closedReason: null };
    }
    const fallback = dateMarker(upcoming[0]);
    return { date: fallback, closedReason: closedReason(fallback) };
  }

  let firstMatch: Date | null = null;

  for (let i = 0; i <= RUN_LOOKAHEAD; i++) {
    const candidate = addDays(from, i);
    if (!days.includes(candidate.getUTCDay())) continue;
    if (!bookable(candidate)) continue;
    if (firstMatch === null) firstMatch = candidate;
    if (closedReason(candidate) === null) return { date: candidate, closedReason: null };
  }

  const fallback = firstMatch ?? addDays(from, 1);
  return { date: fallback, closedReason: closedReason(fallback) };
}

async function load(filter?: { slug?: string; islandSlug?: string }): Promise<Trip[]> {
  const today = todayIST();

  let query = supabase.from("trips").select(SELECT).eq("is_listed", true);
  if (filter?.slug) query = query.eq("slug", filter.slug);
  if (filter?.islandSlug) query = query.eq("island_slug", filter.islandSlug);

  const [rows, taken, closures, paymentMode] = await Promise.all([
    query.order("slug").then((r) => unwrap(r, "trips") as unknown as Row[]),
    takenFor("trip", today, addDays(today, RUN_LOOKAHEAD + 2)),
    closuresFor("trip", today, addDays(today, RUN_LOOKAHEAD + 2)),
    paymentModeFor("trip"),
  ]);

  const galleries = await galleriesFor("trip", rows.map((r) => r.id));

  return rows.map((row) => {
    const runDates = row.run_dates ?? [];
    const departsMins = row.departs_mins ?? 360;
    const { date: runs, closedReason } = nextRun(row.runs_on_days, runDates, departsMins, today, (d) =>
      closureOn(closures, row.id, dayKey(d)),
    );
    const takenCount = takenAt(taken, row.id, runs, departsMins);
    const seatsTaken = row.seats_total == null ? takenCount : Math.min(takenCount, row.seats_total);

    return {
      slug: row.slug,
      title: row.title,
      host: row.host_name,
      hostSince: row.host_since,
      island: row.islands?.name ?? "",
      rating: String(row.rating),
      reviews: row.reviews,
      durationLabel: row.duration_label,
      nextDateLabel: runsLabel(row.runs_on_days, runDates, today),
      departsLabel: fmtClock(departsMins),
      startsAt: instantIso(dayKey(runs), departsMins),
      endsLabel: row.ends_mins != null ? fmtClock(row.ends_mins) : null,
      pricePaise: row.price_paise,
      minSeats: row.min_seats,
      seatsTotal: row.seats_total,
      seatsTaken,
      summary: row.summary,
      includes: row.includes,
      bringList: row.bring_list,
      difficulty: row.difficulty,
      meetPoint: row.meet_point,
      meetAtHotel: row.meet_at_hotel ?? false,
      mapsUrl: row.maps_url ?? null,
      isOpen: closedReason === null,
      closedReason,
      photos: galleries.get(row.id) ?? [],
      paymentMode,
      commissionBps: row.partners?.commission_bps ?? null,
    };
  });
}

export async function getTrips(islandSlug?: string): Promise<Trip[]> {
  return load(islandSlug ? { islandSlug } : undefined);
}

export async function getTrip(slug: string): Promise<Trip | undefined> {
  return (await load({ slug }))[0];
}

export function seatsLeft(trip: Trip) {
  return trip.seatsTotal == null ? Infinity : Math.max(0, trip.seatsTotal - trip.seatsTaken);
}

export function seatsToConfirm(trip: Trip) {
  return Math.max(0, trip.minSeats - trip.seatsTaken);
}
