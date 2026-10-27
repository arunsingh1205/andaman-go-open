"use server";

// The partner side of the cab service — adding a car, editing it, and setting
// its route fares. Same discipline as lib/partner-register.ts: every write goes
// through a SECURITY DEFINER RPC that looks up the caller's own partner_id
// server-side; reads are plain scoped selects the "partner sees own cabs" RLS
// policy (049) already allows.

import { supabaseServer } from "./supabase-server";
import { setListingPhotos, type PartnerActionResult } from "./partner-register";
import type { CabCategory, CabFuel } from "./cabs";

const GENERIC_FAILURE = "Something went wrong. Try again.";

function firstRow<T>(data: unknown): T | null {
  return Array.isArray(data) && data.length > 0 ? (data[0] as T) : null;
}

export type CarInput = {
  category: CabCategory;
  model: string;
  seats: number;
  luggage: number;
  ac: boolean;
  fuel: CabFuel;
  boardNumber: string;
  fullDayPaise: number;
  airportSurchargePaise: number;
  nightSurchargePaise: number;
  perKmPaise: number;
  perMinPaise: number;
  meta: string;
  photoPaths: string[];
};

export async function addPartnerCar(
  input: CarInput,
  /** Set when an admin is adding the car for a business (136) — swaps to the
   *  admin_add_car twin, which takes the business explicitly. */
  forPartnerId?: string,
): Promise<PartnerActionResult<{ cabId: string }>> {
  const supabase = await supabaseServer();
  const carArgs = {
    p_category: input.category,
    p_model: input.model,
    p_seats: input.seats,
    p_luggage: input.luggage,
    p_ac: input.ac,
    p_fuel: input.fuel,
    p_board_number: input.boardNumber,
    p_full_day_paise: input.fullDayPaise,
    p_airport_surcharge_paise: input.airportSurchargePaise,
    p_night_surcharge_paise: input.nightSurchargePaise,
    p_per_km_paise: input.perKmPaise,
    p_per_min_paise: input.perMinPaise,
    p_meta: input.meta,
    p_photo_path: input.photoPaths[0] ?? null,
  };
  const { data, error } = forPartnerId
    ? await supabase.rpc("admin_add_car", { p_partner_id: forPartnerId, ...carArgs })
    : await supabase.rpc("add_partner_car", carArgs);
  if (error) return { ok: false, message: GENERIC_FAILURE };

  const row = firstRow<{ ok: boolean; message: string; cab_id: string | null }>(data);
  if (!row?.ok || !row.cab_id) return { ok: false, message: row?.message ?? GENERIC_FAILURE };

  if (input.photoPaths.length > 0) {
    await setListingPhotos("cab", row.cab_id, input.photoPaths, !!forPartnerId);
  }

  return { ok: true, message: row.message, cabId: row.cab_id };
}

export async function updatePartnerCar(
  id: string,
  input: CarInput,
): Promise<PartnerActionResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("update_partner_car", {
    p_id: id,
    p_category: input.category,
    p_model: input.model,
    p_seats: input.seats,
    p_luggage: input.luggage,
    p_ac: input.ac,
    p_fuel: input.fuel,
    p_board_number: input.boardNumber,
    p_full_day_paise: input.fullDayPaise,
    p_airport_surcharge_paise: input.airportSurchargePaise,
    p_night_surcharge_paise: input.nightSurchargePaise,
    p_per_km_paise: input.perKmPaise,
    p_per_min_paise: input.perMinPaise,
    p_meta: input.meta,
    p_photo_path: input.photoPaths[0] ?? null,
  });
  if (error) return { ok: false, message: GENERIC_FAILURE };
  const row = firstRow<{ ok: boolean; message: string }>(data);
  if (!row?.ok) return { ok: false, message: row?.message ?? GENERIC_FAILURE };

  const photos = await setListingPhotos("cab", id, input.photoPaths);
  if (!photos.ok) return photos;

  return { ok: true, message: row.message };
}

export type CarDetail = CarInput & { id: string };

export async function getOwnCar(partnerId: string, id: string): Promise<CarDetail | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("cabs")
    .select(
      "id, category, model, seats, luggage, ac, fuel, board_number, full_day_paise, airport_surcharge_paise, night_surcharge_paise, per_km_paise, per_min_paise, meta",
    )
    .eq("id", id)
    .eq("partner_id", partnerId)
    .maybeSingle();

  if (error || !data) return null;

  const { data: photos } = await supabase
    .from("listing_photos")
    .select("storage_path, sort_order")
    .eq("listing_kind", "cab")
    .eq("listing_id", id)
    .order("sort_order");

  return {
    id: data.id,
    category: data.category,
    model: data.model,
    seats: data.seats,
    luggage: data.luggage,
    ac: data.ac,
    fuel: data.fuel,
    boardNumber: data.board_number ?? "",
    fullDayPaise: data.full_day_paise,
    airportSurchargePaise: data.airport_surcharge_paise ?? 0,
    nightSurchargePaise: data.night_surcharge_paise ?? 0,
    perKmPaise: data.per_km_paise ?? 0,
    perMinPaise: data.per_min_paise ?? 0,
    meta: data.meta ?? "",
    photoPaths: (photos ?? []).map((p) => p.storage_path as string),
  };
}

export type CarRouteInput = {
  fromPlaceId: string;
  toPlaceId: string;
  onewayPaise: number;
  roundtripPaise: number;
};

export async function getCarRoutes(
  partnerId: string,
  cabId: string,
): Promise<CarRouteInput[] | null> {
  const supabase = await supabaseServer();

  const { data: owner } = await supabase
    .from("cabs")
    .select("id")
    .eq("id", cabId)
    .eq("partner_id", partnerId)
    .maybeSingle();
  if (!owner) return null;

  const { data } = await supabase
    .from("cab_routes")
    .select("from_place_id, to_place_id, oneway_paise, roundtrip_paise")
    .eq("cab_id", cabId);

  return (data ?? []).map((r) => ({
    fromPlaceId: r.from_place_id,
    toPlaceId: r.to_place_id,
    onewayPaise: r.oneway_paise,
    roundtripPaise: r.roundtrip_paise,
  }));
}

export async function setCarRoutes(
  cabId: string,
  routes: CarRouteInput[],
): Promise<PartnerActionResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("set_car_routes", {
    p_cab_id: cabId,
    p_routes: routes.map((r) => ({
      from_place_id: r.fromPlaceId,
      to_place_id: r.toPlaceId,
      oneway_paise: r.onewayPaise,
      roundtrip_paise: r.roundtripPaise,
    })),
  });
  if (error) return { ok: false, message: GENERIC_FAILURE };
  const row = firstRow<{ ok: boolean; message: string }>(data);
  if (!row?.ok) return { ok: false, message: row?.message ?? GENERIC_FAILURE };
  return { ok: true, message: row.message };
}
