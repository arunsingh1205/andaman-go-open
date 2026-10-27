// Cabs / car hire — read from Supabase.
//
// A cab operator is a partner (kind = 'cab'), the way a rental shop is a
// partner (kind = 'rental'). Cars hang off the operator, and each car carries
// its own route fares — (from place, to place, one-way ₹, round-trip ₹) — set
// by the operator. The traveller picks a trip type, a pickup and drop (or a
// number of days for a full-day hire), and sees each car's fare.
//
// Fare is computed in the database when the booking is made (create_cab_booking
// in migration 049). `quoteFare` here is the same sum, for display only.
//
// Cabs carry a commission like every other category, but since migration 137
// it's negotiated per operator, not one flat rate for every cab — each
// operator's own `commission_bps` (on their `partners` row) comes back on
// every `CabOperator`. Checkout collects at least that much online, with the
// rest of the fare paid straight to the driver. `cabPaymentSplit` works out
// the two figures a price box shows, off the operator's own rate.

import { galleriesFor } from "./listing-photos";
import { paymentModeFor, type PaymentMode } from "./payments";
import { CAB_COMMISSION_BPS_FALLBACK } from "./pricing";
import { addDays, dayKey, todayIST } from "./date";
import { supabase, unwrap } from "./supabase";

export type CabTripType = "oneway" | "roundtrip" | "fullday";
export type CabCategory = "hatchback" | "sedan" | "suv" | "tempo";
export type CabFuel = "ev" | "petrol" | "diesel";

export const CAB_TRIP_LABEL: Record<CabTripType, string> = {
  oneway: "One-way",
  roundtrip: "Round trip",
  fullday: "Full day",
};

export const CATEGORY_LABEL: Record<CabCategory, string> = {
  hatchback: "Hatchback",
  sedan: "Sedan",
  suv: "SUV",
  tempo: "Tempo traveller",
};

export const FUEL_LABEL: Record<CabFuel, string> = {
  ev: "Electric",
  petrol: "Petrol",
  diesel: "Diesel",
};

/** Pickups between 22:00 and 06:00 attract the night surcharge, matching
 *  create_cab_booking. */
export function isNightPickup(pickupMins: number): boolean {
  return pickupMins >= 22 * 60 || pickupMins < 6 * 60;
}

export type CabPlace = {
  id: string;
  label: string;
  island: string;
  isAirport: boolean;
  /** Lowercased search terms — "airport", "veer savarkar", "ixz" — for the
   *  typeahead, so a traveller who types "airport" finds the real name. */
  aliases: string[];
};

export type CabRoute = {
  fromId: string;
  toId: string;
  onewayPaise: number;
  roundtripPaise: number;
};

export type Cab = {
  code: string;
  category: CabCategory;
  model: string;
  seats: number;
  luggage: number;
  ac: boolean;
  fuel: CabFuel;
  fullDayPaise: number;
  airportSurchargePaise: number;
  nightSurchargePaise: number;
  meta: string;
  photos: string[];
  routes: CabRoute[];
};

export type CabOperator = {
  slug: string;
  name: string;
  island: string;
  rating: string;
  reviews: number;
  blurb: string;
  paymentMode: PaymentMode;
  /** This operator's own agreed commission, in basis points (migration 137).
   *  Falls back to CAB_COMMISSION_BPS_FALLBACK if somehow unset. */
  commissionBps: number;
  cabs: Cab[];
};

type PlaceRow = {
  id: string;
  label: string;
  island_slug: string;
  is_airport: boolean;
  aliases: string[] | null;
  islands: { name: string } | null;
};

type CabRow = {
  id: string;
  code: string;
  category: CabCategory;
  model: string;
  seats: number;
  luggage: number;
  ac: boolean;
  fuel: CabFuel;
  full_day_paise: number;
  airport_surcharge_paise: number;
  night_surcharge_paise: number;
  meta: string;
  is_listed: boolean;
  cab_routes: {
    from_place_id: string;
    to_place_id: string;
    oneway_paise: number;
    roundtrip_paise: number;
  }[];
};

type OperatorRow = {
  id: string;
  slug: string;
  name: string;
  rating: number | string | null;
  reviews: number;
  blurb: string | null;
  commission_bps: number | null;
  islands: { name: string } | null;
  cabs: CabRow[];
};

const OPERATOR_SELECT = `
  id, slug, name, rating, reviews, blurb, commission_bps,
  islands!inner ( name ),
  cabs (
    id, code, category, model, seats, luggage, ac, fuel,
    full_day_paise, airport_surcharge_paise, night_surcharge_paise, meta, is_listed,
    cab_routes ( from_place_id, to_place_id, oneway_paise, roundtrip_paise )
  )
`;

export async function getCabPlaces(): Promise<CabPlace[]> {
  const rows = (await supabase
    .from("cab_places")
    .select("id, label, island_slug, is_airport, aliases, islands ( name )")
    .order("sort_order")
    .then((r) => unwrap(r, "cab places"))) as unknown as PlaceRow[];

  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    island: r.islands?.name ?? "",
    isAirport: r.is_airport,
    aliases: (r.aliases ?? []).map((a) => a.toLowerCase()),
  }));
}

function toCab(row: CabRow, galleries: Map<string, string[]>): Cab {
  return {
    code: row.code,
    category: row.category,
    model: row.model,
    seats: row.seats,
    luggage: row.luggage,
    ac: row.ac,
    fuel: row.fuel,
    fullDayPaise: row.full_day_paise,
    airportSurchargePaise: row.airport_surcharge_paise ?? 0,
    nightSurchargePaise: row.night_surcharge_paise ?? 0,
    meta: row.meta ?? "",
    photos: galleries.get(row.id) ?? [],
    routes: (row.cab_routes ?? []).map((rt) => ({
      fromId: rt.from_place_id,
      toId: rt.to_place_id,
      onewayPaise: rt.oneway_paise,
      roundtripPaise: rt.roundtrip_paise,
    })),
  };
}

function toOperator(
  row: OperatorRow,
  paymentMode: PaymentMode,
  galleries: Map<string, string[]>,
): CabOperator {
  return {
    slug: row.slug,
    name: row.name,
    island: row.islands?.name ?? "",
    rating: String(row.rating ?? ""),
    reviews: row.reviews,
    blurb: row.blurb ?? "",
    paymentMode,
    commissionBps:
      Number.isFinite(Number(row.commission_bps)) && row.commission_bps != null
        ? Number(row.commission_bps)
        : CAB_COMMISSION_BPS_FALLBACK,
    cabs: row.cabs.filter((c) => c.is_listed).map((c) => toCab(c, galleries)),
  };
}

/** Every listed cab id across a set of operator rows — the key galleriesFor
 *  needs, since a cab gallery hangs off the car, not the operator. */
function cabIds(rows: OperatorRow[]): string[] {
  return rows.flatMap((r) => r.cabs.filter((c) => c.is_listed).map((c) => c.id));
}

export async function getCabOperators(islandSlug?: string): Promise<CabOperator[]> {
  let query = supabase
    .from("partners")
    .select(OPERATOR_SELECT)
    .eq("kind", "cab")
    .eq("status", "approved");
  if (islandSlug) query = query.eq("island_slug", islandSlug);

  const [rows, paymentMode] = await Promise.all([
    query.order("name").then((r) => unwrap(r, "cab operators") as unknown as OperatorRow[]),
    paymentModeFor("cab"),
  ]);

  const galleries = await galleriesFor("cab", cabIds(rows));

  return rows
    .map((row) => toOperator(row, paymentMode, galleries))
    .filter((op) => op.cabs.length > 0);
}

/**
 * The commission on a booking against the standardized rate card — always
 * the 'andaman-go-cabs' house dispatch desk's own partner row, since every
 * rate-card booking's operator is that one partner (create_ratecard_cab_booking,
 * 078/137). NOT a general "the cab commission" — a specific operator's own
 * fleet listing carries its own rate on CabOperator.commissionBps instead.
 * Falls back to the platform default if the row is somehow missing.
 */
export async function getCabCommissionBps(): Promise<number> {
  const { data } = await supabase
    .from("partners")
    .select("commission_bps")
    .eq("slug", "andaman-go-cabs")
    .maybeSingle();
  const bps = Number(data?.commission_bps);
  return Number.isFinite(bps) && bps >= 0 ? bps : CAB_COMMISSION_BPS_FALLBACK;
}

export async function getCabOperator(slug: string): Promise<CabOperator | undefined> {
  const [rows, paymentMode] = await Promise.all([
    supabase
      .from("partners")
      .select(OPERATOR_SELECT)
      .eq("kind", "cab")
      .eq("status", "approved")
      .eq("slug", slug)
      .limit(1)
      .then((r) => unwrap(r, `cab operator "${slug}"`) as unknown as OperatorRow[]),
    paymentModeFor("cab"),
  ]);

  const row = rows[0];
  if (!row) return undefined;

  const galleries = await galleriesFor("cab", cabIds([row]));
  return toOperator(row, paymentMode, galleries);
}

/**
 * How many cabs are out on a given calendar date — keyed by cab code. Reads
 * past booking_items' RLS through the `cab_load_on` security-definer function
 * (049), so a logged-out traveller still sees a car that is already taken.
 */
export async function cabLoadOn(dateKey: string): Promise<Map<string, number>> {
  const { data } = await supabase.rpc("cab_load_on", { p_date: dateKey });
  const map = new Map<string, number>();
  for (const r of (data ?? []) as { cab_code: string; out_count: number }[]) {
    map.set(r.cab_code, Number(r.out_count));
  }
  return map;
}

/** Tomorrow's date key — the earliest a cab can be booked. */
export function firstCabDateKey(): string {
  return dayKey(addDays(todayIST(), 1));
}

export type FareInput = {
  tripType: CabTripType;
  fromId?: string;
  toId?: string;
  days?: number;
  pickupMins?: number;
  /** Whether either end of the trip is an airport — from routeTouchesAirport. */
  airport?: boolean;
};

export type FareBreakdown = {
  /** The route fare or full-day fare, before surcharges. 0 = no such route. */
  basePaise: number;
  airportPaise: number;
  nightPaise: number;
  totalPaise: number;
};

/**
 * The fare a car would charge for a trip, broken into lines — the same sum
 * create_cab_booking runs server-side. `basePaise` is 0 when the operator has
 * set no route for the pair (the screen treats that as "not on this route").
 */
export function fareBreakdown(car: Cab, input: FareInput): FareBreakdown {
  let basePaise = 0;

  if (input.tripType === "fullday") {
    basePaise = car.fullDayPaise * Math.max(1, input.days ?? 1);
  } else {
    const route = car.routes.find(
      (r) => r.fromId === input.fromId && r.toId === input.toId,
    );
    if (route) {
      basePaise =
        input.tripType === "roundtrip" ? route.roundtripPaise : route.onewayPaise;
    }
  }

  if (basePaise <= 0) {
    return { basePaise: 0, airportPaise: 0, nightPaise: 0, totalPaise: 0 };
  }

  const airportPaise =
    input.airport && input.tripType !== "fullday" ? car.airportSurchargePaise : 0;
  const nightPaise =
    input.pickupMins != null && isNightPickup(input.pickupMins)
      ? car.nightSurchargePaise
      : 0;

  return {
    basePaise,
    airportPaise,
    nightPaise,
    totalPaise: basePaise + airportPaise + nightPaise,
  };
}

/** Just the total — the common case. 0 means the car doesn't serve this route. */
export function quoteFare(car: Cab, input: FareInput): number {
  return fareBreakdown(car, input).totalPaise;
}

/** How a cab booking is paid: the whole fare online now, or the commission
 *  online now with the rest owed to the driver. Mirrors the `pay_mode` values
 *  create_cab_booking accepts (073). */
export type CabPayMode = "partial" | "full";

/**
 * The two figures a cab price box and the confirmation screen show: what is
 * paid to Andaman Go online now, and what is still owed to the driver. `full`
 * settles the whole fare online; `partial` pays exactly the commission online
 * (the same sum create_cab_booking computes) and leaves the rest for the
 * driver. `bps` is the specific operator's own commission — CabOperator.commissionBps
 * for a fleet cab, or getCabCommissionBps() for the rate-card dispatch desk.
 */
export function cabPaymentSplit(
  totalPaise: number,
  mode: CabPayMode,
  bps: number,
): { paidNowPaise: number; balancePaise: number } {
  if (mode === "full") return { paidNowPaise: totalPaise, balancePaise: 0 };
  const paidNowPaise = Math.round((totalPaise * bps) / 10000);
  return { paidNowPaise, balancePaise: totalPaise - paidNowPaise };
}

/** Whether either end of a route is an airport — drives the airport surcharge. */
export function routeTouchesAirport(
  places: CabPlace[],
  fromId?: string,
  toId?: string,
): boolean {
  return places.some((p) => (p.id === fromId || p.id === toId) && p.isAirport);
}
