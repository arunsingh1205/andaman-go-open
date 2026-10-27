"use server";

// The admin side of editing a partner's listings — the write path behind
// /admin/listings/[kind]/[id]/edit and /admin/partners/[id]/edit.
//
// Every function here is the admin twin of an updatePartner* / setPartner*
// action in lib/partner-register.ts or lib/partner-cabs.ts, with the SAME
// signature so the shared edit-form components can pick one or the other with
// a single `admin ? adminX : partnerX` at the call site. Each is a thin
// wrapper over an admin_* RPC from 075-admin-listing-edits.sql, which re-checks
// is_admin() itself — this file is a translation layer, never a security
// boundary, same discipline as lib/admin-review.ts.
//
// Unlike the partner path, an admin edit to a live listing does NOT bounce it
// back to pending: the admin_* RPCs leave is_listed / rejection_reason alone.

import { supabaseServer } from "./supabase-server";
import type {
  PartnerActionResult,
  EventAgeRestriction,
  EventTicketInput,
  BadgeTone,
  CommunityServiceInput,
  RentalHour,
} from "./partner-register";
import type { CarInput, CarRouteInput } from "./partner-cabs";

const GENERIC_FAILURE = "Something went wrong. Try again.";

function firstRow<T>(data: unknown): T | null {
  return Array.isArray(data) && data.length > 0 ? (data[0] as T) : null;
}

type Ok = { ok: boolean; message: string };

async function callRpc(
  fn: string,
  args: Record<string, unknown>,
): Promise<PartnerActionResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    // Name the call and the Postgres code so a screenshot is enough to find
    // the cause — the bare generic message hid a dropped function for weeks.
    console.error(`[admin-listing-edit] ${fn} failed:`, error);
    return { ok: false, message: `${GENERIC_FAILURE} (${fn}${error.code ? ` · ${error.code}` : ""})` };
  }
  const row = firstRow<Ok>(data);
  if (!row?.ok) return { ok: false, message: row?.message ?? GENERIC_FAILURE };
  return { ok: true, message: row.message };
}

/** Replace a listing's photo gallery (admin_set_listing_photos, 037/148). */
async function setPhotos(
  kind: "activity" | "rental" | "cab" | "stay" | "event" | "trip" | "ferry" | "community",
  id: string,
  paths: string[],
): Promise<PartnerActionResult> {
  return callRpc("admin_set_listing_photos", { p_kind: kind, p_id: id, p_paths: paths });
}

// ---------------------------------------------------------------------------
// Which business owns a given listing — the edit route needs it to call the
// getOwn* reads. Admins can select any catalogue row ("admins see all X",
// 012/016/049), so this is a plain keyed select.
// ---------------------------------------------------------------------------

const OWNER_TABLE: Record<string, string> = {
  activity: "activities",
  rental: "vehicles",
  cab: "cabs",
  stay: "stays",
  event: "events",
  trip: "trips",
  ferry: "sailings",
  community: "community_services",
};

export async function getListingOwnerId(kind: string, id: string): Promise<string | null> {
  const table = OWNER_TABLE[kind];
  if (!table) return null;
  const supabase = await supabaseServer();
  const { data } = await supabase.from(table).select("partner_id").eq("id", id).maybeSingle();
  return (data?.partner_id as string | undefined) ?? null;
}

// ---------------------------------------------------------------------------
// Listing content — one per kind, matching the updatePartner* signature.
// ---------------------------------------------------------------------------

export async function adminUpdateActivity(
  id: string,
  input: { name: string; summary: string; about: string; pricePaise: number; photoPaths: string[] },
): Promise<PartnerActionResult> {
  const res = await callRpc("admin_update_activity", {
    p_id: id,
    p_name: input.name,
    p_summary: input.summary,
    p_about: input.about,
    p_price_paise: input.pricePaise,
  });
  if (!res.ok) return res;
  return setPhotos("activity", id, input.photoPaths);
}

export async function adminSetActivityLocation(
  id: string,
  input: { area: string; address: string; mapsUrl: string },
): Promise<PartnerActionResult> {
  return callRpc("admin_set_listing_location", {
    p_kind: "activity",
    p_id: id,
    p_area: input.area,
    p_address: input.address,
    p_maps_url: input.mapsUrl,
  });
}

/** Sets a rental shop's area and map link from the vehicle edit screen
 *  (128) — same target columns adminUpdatePartnerProfile writes, just
 *  without needing the rest of the business-profile form loaded. Both
 *  required (130). */
export async function adminSetPartnerArea(
  partnerId: string,
  area: string,
  mapsUrl: string,
): Promise<PartnerActionResult> {
  return callRpc("admin_set_partner_area", {
    p_partner_id: partnerId,
    p_area: area,
    p_maps_url: mapsUrl,
  });
}

export async function adminUpdateVehicle(
  id: string,
  input: {
    model: string;
    ratePaise: number;
    seats: number;
    meta: string;
    units: number;
    securityDepositPaise: number;
    photoPaths: string[];
  },
): Promise<PartnerActionResult> {
  const res = await callRpc("admin_update_vehicle", {
    p_id: id,
    p_model: input.model,
    p_rate_paise: input.ratePaise,
    p_seats: input.seats,
    p_meta: input.meta,
    p_units: input.units,
  });
  if (!res.ok) return res;

  const dep = await callRpc("admin_set_vehicle_security_deposit", {
    p_vehicle_id: id,
    p_paise: input.securityDepositPaise,
  });
  if (!dep.ok) return dep;

  return setPhotos("rental", id, input.photoPaths);
}

export async function adminUpdateCar(id: string, input: CarInput): Promise<PartnerActionResult> {
  const res = await callRpc("admin_update_cab", {
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
  });
  if (!res.ok) return res;
  return setPhotos("cab", id, input.photoPaths);
}

export async function adminSetCarRoutes(
  cabId: string,
  routes: CarRouteInput[],
): Promise<PartnerActionResult> {
  return callRpc("admin_set_car_routes", {
    p_cab_id: cabId,
    p_routes: routes.map((r) => ({
      from_place_id: r.fromPlaceId,
      to_place_id: r.toPlaceId,
      oneway_paise: r.onewayPaise,
      roundtrip_paise: r.roundtripPaise,
    })),
  });
}

export async function adminUpdateStay(
  id: string,
  input: {
    name: string;
    islandSlug: string;
    propertyType: string;
    area: string;
    tagline: string;
    about: string;
    amenities: string[];
    houseRules: string;
    cancellationPolicy: string;
    checkInMins: number;
    checkOutMins: number;
    photoPaths: string[];
  },
): Promise<PartnerActionResult> {
  const res = await callRpc("admin_update_stay", {
    p_id: id,
    p_name: input.name,
    p_island_slug: input.islandSlug,
    p_property_type: input.propertyType,
    p_area: input.area,
    p_tagline: input.tagline,
    p_about: input.about,
    p_amenities: input.amenities,
    p_house_rules: input.houseRules,
    p_cancellation_policy: input.cancellationPolicy,
    p_check_in_mins: input.checkInMins,
    p_check_out_mins: input.checkOutMins,
  });
  if (!res.ok) return res;
  return setPhotos("stay", id, input.photoPaths);
}

export async function adminSetStayLocation(
  id: string,
  input: { address: string; mapsUrl: string },
): Promise<PartnerActionResult> {
  return callRpc("admin_set_stay_location", {
    p_id: id,
    p_address: input.address,
    p_maps_url: input.mapsUrl,
  });
}

export async function adminSetStayRoomTypes(
  stayId: string,
  roomTypes: {
    code?: string;
    name: string;
    maxGuests: number;
    bedrooms: number;
    beds: number;
    bathrooms: number;
    nightlyRatePaise: number;
    quantity: number;
    amenities: string[];
  }[],
): Promise<PartnerActionResult> {
  return callRpc("admin_set_stay_room_types", {
    p_stay_id: stayId,
    p_room_types: roomTypes.map((r) => ({
      code: r.code ?? null,
      name: r.name,
      max_guests: r.maxGuests,
      bedrooms: r.bedrooms,
      beds: r.beds,
      bathrooms: r.bathrooms,
      nightly_rate_paise: r.nightlyRatePaise,
      quantity: r.quantity,
      amenities: r.amenities,
    })),
  });
}

export async function adminUpdateEvent(
  id: string,
  input: {
    name: string;
    venue: string;
    area: string;
    islandSlug: string;
    mapsUrl: string;
    onDate: string;
    timeMins: number;
    /** Approximate end time — optional, descriptive only. */
    endTimeMins: number | null;
    entryPaise: number;
    /** Null means uncapped. */
    capacity: number | null;
    about: string;
    ageRestriction: EventAgeRestriction;
    performer: string;
    photoPaths: string[];
    tickets: EventTicketInput[];
    recurDays: number[];
    recurUntil: string | null;
  },
): Promise<PartnerActionResult> {
  const res = await callRpc("admin_update_event", {
    p_id: id,
    p_name: input.name,
    p_venue: input.venue,
    p_area: input.area,
    p_on_date: input.onDate,
    p_time_mins: input.timeMins,
    p_end_time_mins: input.endTimeMins,
    p_entry_paise: input.entryPaise,
    p_capacity: input.capacity,
    p_about: input.about,
    p_age_restriction: input.ageRestriction,
    p_performer: input.performer,
    p_island_slug: input.islandSlug || null,
    p_maps_url: input.mapsUrl || null,
    p_recur_days: input.recurDays,
    p_recur_until: input.recurUntil,
  });
  if (!res.ok) return res;
  const photos = await setPhotos("event", id, input.photoPaths);
  if (!photos.ok) return photos;
  return callRpc("set_event_tickets", { p_event_id: id, p_tickets: input.tickets });
}

export async function adminUpdateTrip(
  id: string,
  input: {
    title: string;
    hostName: string;
    hostSince: string;
    durationLabel: string;
    runsOnDays: number[];
    runDates: string[];
    departsMins: number;
    /** Approximate return time — optional, descriptive only. */
    endsMins: number | null;
    pricePaise: number;
    difficulty: "easy" | "moderate" | "challenging";
    minSeats: number;
    /** Null means uncapped. */
    seatsTotal: number | null;
    summary: string;
    includes: string[];
    bringList: string[];
    meetPoint: string;
    meetAtHotel: boolean;
    mapsUrl: string;
    photoPaths: string[];
  },
): Promise<PartnerActionResult> {
  const res = await callRpc("admin_update_trip", {
    p_id: id,
    p_title: input.title,
    p_host_name: input.hostName,
    p_host_since: input.hostSince,
    p_duration_label: input.durationLabel,
    p_runs_on_days: input.runsOnDays,
    p_price_paise: input.pricePaise,
    p_difficulty: input.difficulty,
    p_min_seats: input.minSeats,
    p_seats_total: input.seatsTotal,
    p_summary: input.summary,
    p_includes: input.includes,
    p_bring_list: input.bringList,
    p_meet_point: input.meetPoint,
    p_departs_mins: input.departsMins,
    p_run_dates: input.runDates,
    p_meet_at_hotel: input.meetAtHotel,
    p_maps_url: input.mapsUrl,
    p_ends_mins: input.endsMins,
  });
  if (!res.ok) return res;
  return setPhotos("trip", id, input.photoPaths);
}

export async function adminUpdateSailing(
  id: string,
  input: {
    styleLabel: string;
    depMins: number;
    durationMins: number;
    farePaise: number;
    capacity: number;
    daysOfWeek: number[];
    styleTone: BadgeTone;
    info: string;
    infoWarn: boolean;
    photoPaths: string[];
  },
): Promise<PartnerActionResult> {
  const res = await callRpc("admin_update_sailing", {
    p_id: id,
    p_style_label: input.styleLabel,
    p_dep_mins: input.depMins,
    p_duration_mins: input.durationMins,
    p_fare_paise: input.farePaise,
    p_capacity: input.capacity,
    p_days_of_week: input.daysOfWeek,
    p_style_tone: input.styleTone,
    p_info: input.info,
    p_info_warn: input.infoWarn,
  });
  if (!res.ok) return res;
  return setPhotos("ferry", id, input.photoPaths);
}

export async function adminUpdateCommunityService(
  id: string,
  input: CommunityServiceInput,
): Promise<PartnerActionResult> {
  const res = await callRpc("admin_update_community_service", {
    p_id: id,
    p_name: input.name,
    p_organizer_name: input.organizerName,
    p_about: input.about,
    p_on_date: input.onDate,
    p_time_mins: input.timeMins,
    p_end_time_mins: input.endTimeMins,
    p_island_slug: input.islandSlug || null,
    p_maps_url: input.mapsUrl || null,
    p_meeting_point: input.meetingPoint,
    p_what_to_bring: input.whatToBring || null,
    p_safety_notes: input.safetyNotes || null,
    p_min_age: input.minAge,
    p_max_age: input.maxAge,
    p_contact_name: input.contactName,
    p_contact_phone: input.contactPhone,
    p_whatsapp_group_url: input.whatsappGroupUrl || null,
  });
  if (!res.ok) return res;
  return setPhotos("community", id, input.photoPaths);
}

// ---------------------------------------------------------------------------
// Schedules / slots / routes.
// ---------------------------------------------------------------------------

export async function adminSetActivitySchedule(
  activityId: string,
  slots: {
    timeMins: number;
    endTimeMins: number | null;
    capacity: number | null;
    daysOfWeek: number[];
    closedReason: string | null;
  }[],
): Promise<PartnerActionResult> {
  return callRpc("admin_set_activity_schedule", {
    p_activity_id: activityId,
    p_slots: slots.map((s) => ({
      time_mins: s.timeMins,
      end_time_mins: s.endTimeMins,
      capacity: s.capacity,
      days_of_week: s.daysOfWeek,
      closed_reason: s.closedReason,
    })),
  });
}

export async function adminSetActivityMode(
  activityId: string,
  mode: "window" | "fixed",
): Promise<PartnerActionResult> {
  return callRpc("admin_set_activity_mode", { p_activity_id: activityId, p_mode: mode });
}

export async function adminSetRentalHours(
  partnerId: string,
  hours: RentalHour[],
): Promise<PartnerActionResult> {
  return callRpc("admin_set_rental_hours", {
    p_partner_id: partnerId,
    p_slots: hours.map((h) => ({ dow: h.dow, open_mins: h.openMins, close_mins: h.closeMins })),
  });
}

// ---------------------------------------------------------------------------
// Business profile.
// ---------------------------------------------------------------------------

export async function adminUpdatePartnerProfile(
  partnerId: string,
  input: {
    name: string;
    islandSlug: string;
    address: string;
    mapsUrl: string;
    coverPhotoPath: string | null;
    licenseNumber: string;
    licenseDocPath: string | null;
    area: string;
  },
): Promise<PartnerActionResult> {
  return callRpc("admin_update_partner_profile", {
    p_partner_id: partnerId,
    p_name: input.name,
    p_island_slug: input.islandSlug || null,
    p_address: input.address,
    p_maps_url: input.mapsUrl,
    p_cover_photo_path: input.coverPhotoPath,
    p_license_number: input.licenseNumber,
    p_license_doc_path: input.licenseDocPath,
    p_area: input.area,
  });
}

export async function adminSetPartnerContactPhone(
  partnerId: string,
  phone: string,
): Promise<PartnerActionResult> {
  return callRpc("admin_set_partner_contact_phone", { p_partner_id: partnerId, p_phone: phone });
}

export async function adminSetPartnerWhatsappNumber(
  partnerId: string,
  phone: string,
): Promise<PartnerActionResult> {
  return callRpc("admin_set_partner_whatsapp_number", { p_partner_id: partnerId, p_phone: phone });
}
