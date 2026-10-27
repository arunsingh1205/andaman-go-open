"use server";

// Admin-only reads/writes for the rate card (077/078) — this is Andaman Go's
// own price list, not a partner's, so unlike cab_routes it gets an admin
// screen rather than being left to a partner form. Kept apart from
// lib/cab-rate-card.ts, which is the public catalogue read + a pure helper a
// client component can call directly — a "use server" file can only export
// async functions, so the two can't share a module.

import { supabaseServer } from "./supabase-server";
import type { CabCategory } from "./cabs";
import type { CabRateTripType } from "./cab-rate-card";

export type AdminCabRate = {
  id: string;
  islandSlug: string;
  label: string;
  tripType: CabRateTripType;
  fromPlaceId: string | null;
  toPlaceId: string | null;
  vehicleCategory: CabCategory;
  farePaise: number;
  nights: number;
  sortOrder: number;
  isActive: boolean;
};

type RateRow = {
  id: string;
  island_slug: string;
  label: string;
  trip_type: CabRateTripType;
  from_place_id: string | null;
  to_place_id: string | null;
  vehicle_category: CabCategory;
  fare_paise: number;
  nights: number;
  sort_order: number;
  is_active: boolean;
};

function toRate(row: RateRow): AdminCabRate {
  return {
    id: row.id,
    islandSlug: row.island_slug,
    label: row.label,
    tripType: row.trip_type,
    fromPlaceId: row.from_place_id,
    toPlaceId: row.to_place_id,
    vehicleCategory: row.vehicle_category,
    farePaise: row.fare_paise,
    nights: row.nights,
    sortOrder: row.sort_order,
    isActive: row.is_active,
  };
}

/** Every rate card row, active or paused — admins see past their own
 *  "is_active" RLS policy, unlike the public catalogue read. */
export async function getAdminCabRates(): Promise<AdminCabRate[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("cab_rate_card")
    .select(
      "id, island_slug, label, trip_type, from_place_id, to_place_id, vehicle_category, fare_paise, nights, sort_order, is_active",
    )
    .order("island_slug")
    .order("sort_order");
  if (error) throw new Error(`Supabase: could not load the rate card — ${error.message}`);
  return ((data ?? []) as RateRow[]).map(toRate);
}

export type AdminActionResult = { ok: true; message: string } | { ok: false; message: string };

export async function upsertCabRate(input: {
  id?: string;
  islandSlug: string;
  label: string;
  tripType: CabRateTripType;
  fromPlaceId: string | null;
  toPlaceId: string | null;
  vehicleCategory: CabCategory;
  farePaise: number;
  nights: number;
  sortOrder: number;
  isActive: boolean;
}): Promise<AdminActionResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("admin_upsert_cab_rate", {
    p_id: input.id ?? null,
    p_island_slug: input.islandSlug,
    p_label: input.label,
    p_trip_type: input.tripType,
    p_to_place_id: input.toPlaceId,
    p_fare_paise: input.farePaise,
    p_from_place_id: input.fromPlaceId,
    p_vehicle_category: input.vehicleCategory,
    p_nights: input.nights,
    p_sort_order: input.sortOrder,
    p_is_active: input.isActive,
  });
  if (error) return { ok: false, message: "Something went wrong. Try again." };
  const row = Array.isArray(data) && data.length > 0 ? (data[0] as { ok: boolean; message: string }) : null;
  if (!row?.ok) return { ok: false, message: row?.message ?? "Something went wrong. Try again." };
  return { ok: true, message: row.message };
}

export async function setCabRateActive(id: string, active: boolean): Promise<AdminActionResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("admin_set_cab_rate_active", {
    p_id: id,
    p_active: active,
  });
  if (error) return { ok: false, message: "Something went wrong. Try again." };
  const row = Array.isArray(data) && data.length > 0 ? (data[0] as { ok: boolean; message: string }) : null;
  if (!row?.ok) return { ok: false, message: row?.message ?? "Something went wrong. Try again." };
  return { ok: true, message: row.message };
}
