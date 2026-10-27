// The union/standardized cab rate card — read from Supabase.
//
// Unlike the self-service marketplace (lib/cabs.ts), a rate-card fare belongs
// to Andaman Go, not to a partner: one fixed price per named destination,
// independent of which car or driver eventually takes the trip. The
// traveller books and pays against this table directly (create_ratecard_cab_
// booking, migration 078); a driver is assigned afterwards by an admin.
//
// `rateCardFare` mirrors the database's own lookup exactly (078): an exact
// (from, to) match first, then the "any pickup in the standard zone"
// wildcard row for the same destination. Kept here, display-only, the same
// trade lib/cabs.ts makes with `fareBreakdown`.

import type { CabCategory } from "./cabs";
import { supabase, unwrap } from "./supabase";

export type CabRateTripType = "oneway" | "roundtrip" | "outstation";

export const RATE_TRIP_LABEL: Record<CabRateTripType, string> = {
  oneway: "One-way",
  roundtrip: "Round trip",
  outstation: "Multi-day package",
};

export type CabRate = {
  id: string;
  label: string;
  tripType: CabRateTripType;
  fromPlaceId: string | null;
  toPlaceId: string | null;
  vehicleCategory: CabCategory;
  farePaise: number;
  nights: number;
};

type RateRow = {
  id: string;
  label: string;
  trip_type: CabRateTripType;
  from_place_id: string | null;
  to_place_id: string | null;
  vehicle_category: CabCategory;
  fare_paise: number;
  nights: number;
};

export async function getCabRateCard(islandSlug: string): Promise<CabRate[]> {
  const rows = (await supabase
    .from("cab_rate_card")
    .select("id, label, trip_type, from_place_id, to_place_id, vehicle_category, fare_paise, nights")
    .eq("island_slug", islandSlug)
    .order("sort_order")
    .then((r) => unwrap(r, "cab rate card"))) as unknown as RateRow[];

  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    tripType: r.trip_type,
    fromPlaceId: r.from_place_id,
    toPlaceId: r.to_place_id,
    vehicleCategory: r.vehicle_category,
    farePaise: r.fare_paise,
    nights: r.nights,
  }));
}

export type RateFareInput = {
  tripType: CabRateTripType;
  fromPlaceId: string | null;
  toPlaceId: string | null;
  vehicleCategory: CabCategory;
};

/**
 * The fare for a trip, or undefined when nothing on the card covers it.
 * Exact (from, to) match first; if the traveller picked a specific pickup
 * with no zone-priced row of its own, falls back to the wildcard row (a null
 * `fromPlaceId`) for the same destination — the same two-step lookup
 * create_ratecard_cab_booking runs server-side.
 */
export function rateCardFare(rates: CabRate[], input: RateFareInput): CabRate | undefined {
  const exact = rates.find(
    (r) =>
      r.tripType === input.tripType &&
      r.vehicleCategory === input.vehicleCategory &&
      r.fromPlaceId === input.fromPlaceId &&
      r.toPlaceId === input.toPlaceId,
  );
  if (exact) return exact;

  if (input.fromPlaceId === null) return undefined;

  return rates.find(
    (r) =>
      r.tripType === input.tripType &&
      r.vehicleCategory === input.vehicleCategory &&
      r.fromPlaceId === null &&
      r.toPlaceId === input.toPlaceId,
  );
}
