// Rentals — read from Supabase.
//
// A rental shop is a partner, and the shop is what a traveller browses, so its
// rating and blurb sit on the partner row rather than on a separate listing.
//
// Vehicles now carry `seats`. That is the number Plan my day needs: four people
// do not share one bicycle, they need ceil(4 / seats) of them.

import { addDays, BOOKING_CUTOFF_HOURS, dayKey, fmtDateLabel, fmtDayNum, fmtMonth, fmtClock, instantIso, isPastCutoff, todayIST } from "./date";
import { galleriesFor } from "./listing-photos";
import { paymentModeFor, type PaymentMode } from "./payments";
import { supabase, unwrap } from "./supabase";

export type VehicleType = "scooter" | "bike" | "bicycle";

export type Vehicle = {
  id: string;
  type: VehicleType;
  model: string;
  ratePaise: number;
  /** How many people one of these carries. */
  seats: number;
  meta: string;
  /** The refundable cash bond the shop takes at the counter (035). */
  securityDepositPaise: number;
  /** How many of this model the shop owns. */
  stock: number;
  /** How many are free for the default pick-up date. A hint — the database
   *  does the real per-day check across the whole rental when you book. */
  available: number;
  /** Partner-uploaded photos, cover first — empty until a partner adds any (037). */
  photos: string[];
};

export type ShopHours = { dow: number; openMins: number; closeMins: number };

export type Shop = {
  slug: string;
  name: string;
  island: string;
  rating: string;
  reviews: number;
  distance: string;
  /** Where the shop actually is — null until the partner or an admin sets
   *  one (127). Lets a traveller compare shops by "which is nearby" before
   *  opening either one. */
  area: string | null;
  blurb: string;
  vehicles: Vehicle[];
  /** Deposit allowed, or full payment only (034). */
  paymentMode: PaymentMode;
  /** The weekday windows the shop hands vehicles over in (035). Empty = the
   *  shop hasn't set hours, and pick-up falls back to 9 AM. */
  hours: ShopHours[];
  /** This shop's own agreed commission, in basis points (138) — what a
   *  deposit actually collects online now. */
  commissionBps: number | null;
  /**
   * How many of each vehicle are already out, per day, across the whole
   * pick-up window (151) — vehicle id -> dateKey -> count out that day.
   * Only getShop() (the single-shop / booking-page read) populates this;
   * getShops() (the browse list, which never shows a count) leaves it
   * empty rather than pay for a query nothing reads. The booking screen
   * works out the real peak load for whatever (date, days) is selected from
   * this, the same window create_booking's own 'rental' branch checks at
   * booking time — Vehicle.available below is just the single-day fallback
   * for a reader with no date of its own yet.
   */
  loadByVehicleDate: Record<string, Record<string, number>>;
};

export const DELIVERY_PAISE = 10000;
export const MAX_DAYS = 14;
/** How far ahead a traveller can set pick-up — same order as ferry's
 *  30-day search window (lib/ferries.ts DAYS_WINDOW), long enough for
 *  someone booking a rental for later in their trip rather than right now. */
export const PICKUP_WINDOW_DAYS = 30;

export const TYPE_LABEL: Record<VehicleType, string> = {
  scooter: "Scooters",
  bike: "Bikes",
  bicycle: "Cycles",
};

type Row = {
  id: string;
  slug: string;
  name: string;
  rating: number | string | null;
  reviews: number;
  distance_label: string | null;
  area: string | null;
  blurb: string | null;
  commission_bps: number | null;
  islands: { name: string } | null;
  vehicles: {
    id: string;
    code: string;
    type: VehicleType;
    model: string;
    rate_paise: number;
    seats: number;
    meta: string;
    units: number;
    security_deposit_paise: number;
    is_listed: boolean;
  }[];
  rental_hours: { dow: number; open_mins: number; close_mins: number }[];
};

const SELECT = `
  id, slug, name, rating, reviews, distance_label, area, blurb, commission_bps,
  islands!inner ( name ),
  vehicles ( id, code, type, model, rate_paise, seats, meta, units, security_deposit_paise, is_listed ),
  rental_hours ( dow, open_mins, close_mins )
`;

/** Vehicles handed over at 9 AM unless the shop has set opening hours (035). */
export const DEFAULT_PICKUP_MINS = 9 * 60;

/** The pick-up time for a shop on a given weekday: its opening minute that
 *  day, or the 9 AM fallback when it keeps no hours. */
export function pickupMinsFor(hours: ShopHours[], dow: number): number {
  const today = hours.find((h) => h.dow === dow);
  return today ? today.openMins : DEFAULT_PICKUP_MINS;
}

/** The close of a shop's hand-over window on a weekday — 6 PM when it keeps no
 *  hours, matching create_booking's own `between open_mins and close_mins`. */
const RENTAL_CLOSE_FALLBACK_MINS = 18 * 60;

/**
 * The pick-up times a traveller can choose for a shop on `dow` — hourly through
 * the shop's opening window so the partner knows when to expect them, instead
 * of every rental silently landing at 9 AM. create_booking rejects a time
 * outside `rental_hours`, so these stay inside it.
 */
export function rentalPickupOptions(
  hours: ShopHours[],
  dow: number,
): { mins: number; label: string }[] {
  const today = hours.find((h) => h.dow === dow);
  const open = today ? today.openMins : DEFAULT_PICKUP_MINS;
  const close = today ? today.closeMins : RENTAL_CLOSE_FALLBACK_MINS;

  const out: { mins: number; label: string }[] = [];
  for (let m = open; m <= close; m += 60) out.push({ mins: m, label: fmtClock(m) });
  return out.length ? out : [{ mins: open, label: fmtClock(open) }];
}

/**
 * The date pick-up actually falls on, plus the hourly times still on offer
 * that day. Same-day pick-up is offered whenever the shop's hours still leave
 * a slot more than BOOKING_CUTOFF_HOURS out; once the day's last such slot
 * passes that cutoff, this moves to tomorrow with its full set of hours —
 * the same "pick-up is always tomorrow" behaviour this replaces.
 */
export function pickupWindow(
  hours: ShopHours[],
  from: Date = todayIST(),
): { date: Date; options: { mins: number; label: string }[] } {
  const todays = rentalPickupOptions(hours, from.getUTCDay()).filter(
    (o) => !isPastCutoff(instantIso(dayKey(from), o.mins), BOOKING_CUTOFF_HOURS),
  );
  if (todays.length > 0) return { date: from, options: todays };

  const tomorrow = addDays(from, 1);
  return { date: tomorrow, options: rentalPickupOptions(hours, tomorrow.getUTCDay()) };
}

function toShop(
  row: Row,
  paymentMode: PaymentMode,
  loadByVehicle: Map<string, number>,
  galleries: Map<string, string[]>,
  loadByVehicleDate: Record<string, Record<string, number>> = {},
): Shop {
  const hours: ShopHours[] = (row.rental_hours ?? []).map((h) => ({
    dow: h.dow,
    openMins: h.open_mins,
    closeMins: h.close_mins,
  }));

  return {
    slug: row.slug,
    name: row.name,
    island: row.islands?.name ?? "",
    rating: String(row.rating ?? ""),
    reviews: row.reviews,
    distance: row.distance_label ?? "",
    area: row.area ?? null,
    blurb: row.blurb ?? "",
    paymentMode,
    hours,
    commissionBps: row.commission_bps ?? null,
    loadByVehicleDate,
    vehicles: row.vehicles
      .filter((v) => v.is_listed)
      .sort((a, b) => a.rate_paise - b.rate_paise)
      .map((v) => ({
        id: v.code,
        type: v.type,
        model: v.model,
        ratePaise: v.rate_paise,
        seats: v.seats,
        meta: v.meta,
        securityDepositPaise: v.security_deposit_paise ?? 0,
        stock: v.units ?? 1,
        available: Math.max(0, (v.units ?? 1) - (loadByVehicle.get(v.id) ?? 0)),
        photos: galleries.get(v.id) ?? [],
      })),
  };
}

/** Every listed vehicle id across a set of shop rows — the key galleriesFor
 *  needs, since a rental gallery hangs off the vehicle, not the shop. */
function vehicleIds(rows: Row[]): string[] {
  return rows.flatMap((r) => r.vehicles.filter((v) => v.is_listed).map((v) => v.id));
}

/** How many of each vehicle are already out on the default pick-up date —
 *  keyed by vehicles.id. Reads past booking_items' RLS through the
 *  `rental_load_on` security-definer function (043), so a logged-out traveller
 *  still sees a sold-out vehicle. Just a hint at listing time (before a shop's
 *  own hours are known) — today is the closer approximation now that pick-up
 *  can land same-day (see pickupWindow above); the real per-day check happens
 *  in create_booking regardless. */
async function loadOnPickupDate(): Promise<Map<string, number>> {
  const pickupDate = dayKey(todayIST());
  const { data } = await supabase.rpc("rental_load_on", { p_date: pickupDate });

  const map = new Map<string, number>();
  for (const r of (data ?? []) as { variant_id: string; out_count: number }[]) {
    map.set(r.variant_id, Number(r.out_count));
  }
  return map;
}

/**
 * Every vehicle's out-count for every day it has one, across the whole
 * pick-up window plus the longest possible rental (151) — enough to cover
 * any (date, days) combination the booking screen's own pickers can
 * produce. Vehicle id -> dateKey -> count out. A plain object, not a Map:
 * this crosses the server/client boundary as a prop, and only JSON-safe
 * values survive that trip.
 */
async function loadWindow(): Promise<Record<string, Record<string, number>>> {
  const from = dayKey(todayIST());
  const to = dayKey(addDays(todayIST(), PICKUP_WINDOW_DAYS + MAX_DAYS));
  const { data } = await supabase.rpc("rental_load_between", { p_from: from, p_to: to });

  const out: Record<string, Record<string, number>> = {};
  for (const r of (data ?? []) as { variant_id: string; on_date: string; out_count: number }[]) {
    (out[r.variant_id] ??= {})[r.on_date] = Number(r.out_count);
  }
  return out;
}

export async function getShops(islandSlug?: string): Promise<Shop[]> {
  let query = supabase.from("partners").select(SELECT).eq("kind", "rental").eq("status", "approved");
  if (islandSlug) query = query.eq("island_slug", islandSlug);

  const [rows, paymentMode, load] = await Promise.all([
    query.order("name").then((r) => unwrap(r, "rental shops") as unknown as Row[]),
    paymentModeFor("rental"),
    loadOnPickupDate(),
  ]);

  const galleries = await galleriesFor("rental", vehicleIds(rows));

  return rows
    .map((row) => toShop(row, paymentMode, load, galleries))
    .filter((shop) => shop.vehicles.length > 0);
}

export async function getShop(slug: string): Promise<Shop | undefined> {
  const [rows, paymentMode, load, loadWindowByDate] = await Promise.all([
    supabase
      .from("partners")
      .select(SELECT)
      .eq("kind", "rental")
      .eq("status", "approved")
      .eq("slug", slug)
      .limit(1)
      .then((r) => unwrap(r, `rental shop "${slug}"`) as unknown as Row[]),
    paymentModeFor("rental"),
    loadOnPickupDate(),
    loadWindow(),
  ]);

  const row = rows[0];
  if (!row) return undefined;

  const galleries = await galleriesFor("rental", vehicleIds([row]));
  return toShop(row, paymentMode, load, galleries, loadWindowByDate);
}

export function cheapestPaise(shop: Shop) {
  return Math.min(...shop.vehicles.map((v) => v.ratePaise));
}

export function typesIn(shop: Shop): VehicleType[] {
  return (["scooter", "bike", "bicycle"] as VehicleType[]).filter((t) =>
    shop.vehicles.some((v) => v.type === t),
  );
}

export type RentalDates = {
  pickupLabel: string;
  /** The exact instant of pick-up. */
  startsAt: string;
  returnLabels: string[];
  rangeLabels: string[];
};

/**
 * The pick-up / return dates the booking screen shows, for a pick-up that's
 * already been placed on `pickupDateKey` (today or tomorrow, per
 * pickupWindow above). `pickupMins` comes from the shop's opening hours for
 * that day (035); callers that don't have a shop yet get the 9 AM default.
 */
export async function getRentalDates(
  pickupDateKey: string,
  pickupMins: number = DEFAULT_PICKUP_MINS,
): Promise<RentalDates> {
  const start = new Date(`${pickupDateKey}T00:00:00Z`);
  const clockLabel = fmtClock(pickupMins);

  const returnLabels: string[] = [];
  const rangeLabels: string[] = [];

  for (let n = 1; n <= MAX_DAYS; n++) {
    const end = addDays(start, n);
    returnLabels.push(`${fmtDateLabel(end)}, ${clockLabel}`);

    // Same month reads "25–28 Aug"; across a month boundary both months are
    // named, because "25–1 Sep" is not a date range anybody can parse.
    rangeLabels.push(
      start.getUTCMonth() === end.getUTCMonth()
        ? `${fmtDayNum(start)}–${fmtDayNum(end)} ${fmtMonth(end)}`
        : `${fmtDayNum(start)} ${fmtMonth(start)} – ${fmtDayNum(end)} ${fmtMonth(end)}`,
    );
  }

  return {
    pickupLabel: `${fmtDateLabel(start)}, ${clockLabel}`,
    startsAt: instantIso(dayKey(start), pickupMins),
    returnLabels,
    rangeLabels,
  };
}
