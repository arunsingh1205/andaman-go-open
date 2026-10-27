// Stays & Homestays — read from Supabase.
//
// A stay is a property (homestay, guesthouse, villa, resort or hostel) with
// one or more room types under it — a single-room homestay is just one room
// type with quantity 1. Approval happens at the property level only; a room
// type is operational data under an approved stay, same as a restaurant's
// table sittings used to be.
//
// Stays carry a commission like every other category, but since migration
// 137 it's negotiated per property, not one flat rate for every stay — each
// property's own `commission_bps` (on its `partners` row) comes back as part
// of the Stay. Checkout collects at least that commission online, with the
// rest settled at the property. `stayPaymentSplit` works out the two figures
// a price box shows, off the property's own rate. This mirrors lib/cabs.ts.

import { addDays, dayKey } from "./date";
import { galleriesFor } from "./listing-photos";
import { STAY_COMMISSION_BPS_FALLBACK } from "./pricing";
import { supabase, unwrap } from "./supabase";

export type PropertyType = "homestay" | "guesthouse" | "villa" | "resort" | "hostel" | "hotel";
export type CancellationPolicy = "flexible" | "moderate" | "strict";

export const PROPERTY_TYPE_LABEL: Record<PropertyType, string> = {
  homestay: "Homestay",
  guesthouse: "Guesthouse",
  villa: "Villa",
  resort: "Resort",
  hostel: "Hostel",
  hotel: "Hotel",
};

export const CANCELLATION_LABEL: Record<CancellationPolicy, string> = {
  flexible: "Flexible — full refund of the balance up to 24 hours before check-in",
  moderate: "Moderate — half the balance refunded up to 3 days before check-in",
  strict: "Strict — the balance is not refundable once booked",
};

/** The amenities a property or a room type can offer — shared checklist
 *  vocabulary for the partner wizard, the listing page, and admin review. */
export const STAY_AMENITIES = [
  "wifi",
  "ac",
  "hot_water",
  "kitchen",
  "parking",
  "tv",
  "breakfast",
  "pool",
  "backup_power",
  "beach_access",
  "washing_machine",
  "workspace",
] as const;
export type StayAmenity = (typeof STAY_AMENITIES)[number];

export const AMENITY_LABEL: Record<StayAmenity, string> = {
  wifi: "Wi-Fi",
  ac: "Air conditioning",
  hot_water: "Hot water",
  kitchen: "Kitchen / kitchenette",
  parking: "Parking",
  tv: "TV",
  breakfast: "Breakfast included",
  pool: "Pool",
  backup_power: "Backup power",
  beach_access: "Beach access",
  washing_machine: "Washing machine",
  workspace: "Workspace",
};

export type StayRoomType = {
  id: string;
  code: string;
  name: string;
  maxGuests: number;
  bedrooms: number;
  beds: number;
  bathrooms: number;
  nightlyRatePaise: number;
  /** How many identical units of this room type the property has. */
  quantity: number;
  amenities: string[];
};

export type Stay = {
  slug: string;
  mark: string;
  name: string;
  propertyType: PropertyType;
  island: string;
  area: string;
  tagline: string;
  about: string;
  amenities: string[];
  houseRules: string;
  cancellationPolicy: CancellationPolicy;
  checkInMins: number;
  checkOutMins: number;
  rating: string;
  reviews: number;
  /** Partner-uploaded photos, cover first. */
  photos: string[];
  roomTypes: StayRoomType[];
  /** This property's own agreed commission, in basis points (migration 137).
   *  Falls back to STAY_COMMISSION_BPS_FALLBACK if somehow unset. */
  commissionBps: number;
};

type RoomTypeRow = {
  id: string;
  code: string;
  name: string;
  max_guests: number;
  bedrooms: number;
  beds: number;
  bathrooms: number;
  nightly_rate_paise: number;
  quantity: number;
  amenities: string[] | null;
};

type Row = {
  id: string;
  slug: string;
  mark: string;
  name: string;
  property_type: PropertyType;
  area: string;
  tagline: string;
  about: string;
  amenities: string[] | null;
  house_rules: string;
  cancellation_policy: CancellationPolicy;
  check_in_mins: number;
  check_out_mins: number;
  rating: number | string | null;
  reviews: number;
  islands: { name: string } | null;
  partners: { commission_bps: number | null } | { commission_bps: number | null }[] | null;
  stay_room_types: RoomTypeRow[];
};

const SELECT = `
  id, slug, mark, name, property_type, area, tagline, about, amenities,
  house_rules, cancellation_policy, check_in_mins, check_out_mins, rating, reviews,
  islands!inner ( name ),
  partners!inner ( commission_bps ),
  stay_room_types ( id, code, name, max_guests, bedrooms, beds, bathrooms, nightly_rate_paise, quantity, amenities )
`;

function toRoomType(row: RoomTypeRow): StayRoomType {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    maxGuests: row.max_guests,
    bedrooms: row.bedrooms,
    beds: row.beds,
    bathrooms: row.bathrooms,
    nightlyRatePaise: row.nightly_rate_paise,
    quantity: row.quantity,
    amenities: row.amenities ?? [],
  };
}

/** Supabase returns a to-one join as an object or a one-element array
 *  depending on the query shape — normalise either to the commission rate,
 *  falling back to the platform default if the row is somehow unset. */
function partnerCommissionBps(p: Row["partners"]): number {
  const row = Array.isArray(p) ? p[0] : p;
  const bps = Number(row?.commission_bps);
  return Number.isFinite(bps) && bps >= 0 ? bps : STAY_COMMISSION_BPS_FALLBACK;
}

function toStay(row: Row, photos: string[]): Stay {
  return {
    slug: row.slug,
    mark: row.mark,
    name: row.name,
    propertyType: row.property_type,
    island: row.islands?.name ?? "",
    area: row.area,
    tagline: row.tagline,
    about: row.about,
    amenities: row.amenities ?? [],
    houseRules: row.house_rules,
    cancellationPolicy: row.cancellation_policy,
    checkInMins: row.check_in_mins,
    checkOutMins: row.check_out_mins,
    rating: String(row.rating ?? ""),
    reviews: row.reviews,
    photos,
    roomTypes: (row.stay_room_types ?? []).map(toRoomType),
    commissionBps: partnerCommissionBps(row.partners),
  };
}

export async function getStays(islandSlug?: string): Promise<Stay[]> {
  let query = supabase.from("stays").select(SELECT).eq("is_listed", true);
  if (islandSlug) query = query.eq("island_slug", islandSlug);

  const rows = (await query
    .order("name")
    .then((r) => unwrap(r, "stays"))) as unknown as Row[];

  const galleries = await galleriesFor("stay", rows.map((r) => r.id));

  return rows
    .map((row) => toStay(row, galleries.get(row.id) ?? []))
    .filter((s) => s.roomTypes.length > 0);
}

export async function getStay(slug: string): Promise<Stay | undefined> {
  const rows = (await supabase
    .from("stays")
    .select(SELECT)
    .eq("is_listed", true)
    .eq("slug", slug)
    .limit(1)
    .then((r) => unwrap(r, `stay "${slug}"`))) as unknown as Row[];

  const row = rows[0];
  if (!row) return undefined;

  const galleries = await galleriesFor("stay", [row.id]);
  return toStay(row, galleries.get(row.id) ?? []);
}

/**
 * How many of each room type are booked out per night, in [fromDateKey,
 * toDateKey). Reads the stay_room_load() function (097) — a SECURITY
 * DEFINER function, not a bare RLS-bypassing view (that shape trips
 * Supabase's security_definer_view lint), same trade rental_load/
 * cab_load_on make so a logged-out traveller can see a sold-out night.
 */
export async function stayRoomLoadBetween(
  roomTypeIds: string[],
  fromDateKey: string,
  toDateKey: string,
): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  if (roomTypeIds.length === 0) return out;

  const { data } = await supabase.rpc("stay_room_load", {
    p_room_type_ids: roomTypeIds,
    p_from: fromDateKey,
    p_to: toDateKey,
  });

  for (const r of (data ?? []) as {
    stay_room_type_id: string;
    on_date: string;
    out_count: number;
  }[]) {
    const byDate = out.get(r.stay_room_type_id) ?? new Map<string, number>();
    byDate.set(r.on_date, Number(r.out_count));
    out.set(r.stay_room_type_id, byDate);
  }
  return out;
}

/** How many nights are free for a room type across [checkInKey, checkOutKey),
 *  given today's load map from stayRoomLoadBetween. Infinity-safe: a room
 *  type with no bookings at all simply has no entries in the map. */
export function roomsLeftOn(
  load: Map<string, Map<string, number>>,
  roomTypeId: string,
  quantity: number,
  dateKey: string,
): number {
  const out = load.get(roomTypeId)?.get(dateKey) ?? 0;
  return Math.max(0, quantity - out);
}

/** Whole room type is bookable across every night of [checkInKey,
 *  checkOutKey) — the client-side echo of the server's own peak-load check
 *  in create_stay_booking (097). The database is the real gate; this is
 *  only for a fast "sold out" hint before checkout. */
export function roomTypeFreeAcross(
  load: Map<string, Map<string, number>>,
  roomTypeId: string,
  quantity: number,
  checkInKey: string,
  nights: number,
): boolean {
  let d = new Date(`${checkInKey}T00:00:00Z`);
  for (let n = 0; n < nights; n++) {
    if (roomsLeftOn(load, roomTypeId, quantity, dayKey(d)) <= 0) return false;
    d = addDays(d, 1);
  }
  return true;
}

export type StayPayMode = "partial" | "full";

/**
 * The two figures a stay price box and the confirmation screen show: what is
 * paid to Andaman Go online now, and what is still owed at the property.
 * `full` settles the whole stay online; `partial` pays exactly the
 * commission (the same sum create_stay_booking computes) and leaves the rest
 * for check-in. `bps` is the specific property's own commission — Stay.commissionBps.
 */
export function stayPaymentSplit(
  totalPaise: number,
  mode: StayPayMode,
  bps: number,
): { paidNowPaise: number; balancePaise: number } {
  if (mode === "full") return { paidNowPaise: totalPaise, balancePaise: 0 };
  const paidNowPaise = Math.round((totalPaise * bps) / 10000);
  return { paidNowPaise, balancePaise: totalPaise - paidNowPaise };
}

/** Nights between two YYYY-MM-DD keys, at least 1. */
export function nightsBetween(checkInKey: string, checkOutKey: string): number {
  const a = new Date(`${checkInKey}T00:00:00Z`).getTime();
  const b = new Date(`${checkOutKey}T00:00:00Z`).getTime();
  return Math.max(1, Math.round((b - a) / 86_400_000));
}

/** The check-out date key, `nights` after check-in. */
export function checkOutKey(checkInKey: string, nights: number): string {
  return dayKey(addDays(new Date(`${checkInKey}T00:00:00Z`), nights));
}
