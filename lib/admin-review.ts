"use server";

// The admin side of the review queues 011 created. Every mutation here is a
// thin wrapper over a SECURITY DEFINER RPC from 012-admin-review.sql, which
// re-checks is_admin() itself — this file doesn't trust the caller either,
// same discipline as partner-register.ts and partner-actions.ts.
//
// Reads are plain scoped selects, same as getPartnerListings() — the
// "admins see all X" RLS policies from 012/016 are what actually let these
// through; no RPC needed just to look.

import { supabaseServer } from "./supabase-server";
import { PARTNER_KIND_LABEL, type PartnerKind } from "./partner-kind";
import { listingPhotoUrl } from "./photos";
import { islandLabel } from "./islands";
import { GENRE_LABEL, type Genre } from "./events";
import { countCabsToAssign } from "./admin-bookings";

export type AdminActionResult = { ok: true; message: string } | { ok: false; message: string };

const GENERIC_FAILURE = "Something went wrong. Try again.";

function firstRow<T>(data: unknown): T | null {
  return Array.isArray(data) && data.length > 0 ? (data[0] as T) : null;
}

// ---------------------------------------------------------------------------
// Partners
// ---------------------------------------------------------------------------

export type PendingPartner = {
  id: string;
  name: string;
  kindLabel: string;
  islandSlug: string;
  contactPhone: string | null;
  address: string | null;
  mapsUrl: string | null;
  coverPhotoPath: string | null;
  licenseNumber: string | null;
  licenseDocPath: string | null;
  status: "pending" | "approved" | "suspended" | "rejected" | "deleted";
  rejectionReason: string | null;
  createdAt: string;
  /** This business's own agreed commission, in basis points (migration 137)
   *  — null until the admin sets one, which is required before approval. */
  commissionBps: number | null;
};

export async function listPartners(filter: "pending" | "rejected" | "all"): Promise<PendingPartner[]> {
  const supabase = await supabaseServer();
  let query = supabase
    .from("partners")
    .select(
      "id, name, kind, island_slug, contact_phone, address, maps_url, cover_photo_path, license_number, license_doc_path, status, rejection_reason, created_at, commission_bps",
    )
    .order("created_at", { ascending: true });

  if (filter !== "all") query = query.eq("status", filter);

  const { data, error } = await query;
  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id,
    name: row.name,
    kindLabel: PARTNER_KIND_LABEL[row.kind as PartnerKind] ?? row.kind,
    islandSlug: row.island_slug,
    contactPhone: row.contact_phone,
    address: row.address,
    mapsUrl: row.maps_url,
    coverPhotoPath: row.cover_photo_path,
    licenseNumber: row.license_number,
    licenseDocPath: row.license_doc_path,
    status: row.status,
    rejectionReason: row.rejection_reason,
    createdAt: row.created_at,
    commissionBps: row.commission_bps,
  }));
}

export async function approvePartner(partnerId: string): Promise<AdminActionResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("admin_approve_partner", { p_partner_id: partnerId });
  if (error) return { ok: false, message: GENERIC_FAILURE };
  const row = firstRow<{ ok: boolean; message: string }>(data);
  if (!row?.ok) return { ok: false, message: row?.message ?? GENERIC_FAILURE };
  return { ok: true, message: row.message };
}

export async function rejectPartner(partnerId: string, reason: string): Promise<AdminActionResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("admin_reject_partner", {
    p_partner_id: partnerId,
    p_reason: reason,
  });
  if (error) return { ok: false, message: GENERIC_FAILURE };
  const row = firstRow<{ ok: boolean; message: string }>(data);
  if (!row?.ok) return { ok: false, message: row?.message ?? GENERIC_FAILURE };
  return { ok: true, message: row.message };
}

// ---------------------------------------------------------------------------
// Listings — activities, vehicles ("rental"), cabs, stays, events, trips,
// and sailings ("ferry"). `kind` matches the same values partner-register.ts
// already uses for OwnListing, and what booking_items.kind uses for these
// catalogue tables.
// ---------------------------------------------------------------------------

export type ListingKind =
  | "activity"
  | "rental"
  | "cab"
  | "stay"
  | "event"
  | "trip"
  | "ferry"
  | "community";

export type PendingListing = {
  id: string;
  kind: ListingKind;
  partnerId: string;
  partnerName: string;
  title: string;
  detail: string;
  /** Cover photo path, kept in sync with photos[0] (037). Still here for
   *  callers that only want one; new code should prefer `photos`. */
  photoPath: string | null;
  /** The full gallery a traveller will see, cover first — as public URLs (037). */
  photos: string[];
  rejectionReason: string | null;
};

export async function listListings(filter: "pending" | "rejected" | "all"): Promise<PendingListing[]> {
  const supabase = await supabaseServer();

  const [activities, vehicles, cabs, stays, events, trips, sailings, communityServices] =
    await Promise.all([
      supabase
        .from("activities")
        .select(
          "id, partner_id, name, category, price_paise, is_listed, photo_path, rejection_reason, partners(name)",
        )
        .is("deleted_at", null),
      supabase
        .from("vehicles")
        .select(
          "id, partner_id, model, type, rate_paise, units, is_listed, photo_path, rejection_reason, partners(name)",
        )
        .is("deleted_at", null),
      supabase
        .from("cabs")
        .select(
          "id, partner_id, model, category, full_day_paise, is_listed, photo_path, rejection_reason, partners(name)",
        )
        .is("deleted_at", null),
      supabase
        .from("stays")
        .select(
          "id, partner_id, name, island_slug, property_type, is_listed, photo_path, rejection_reason, partners(name), stay_room_types ( nightly_rate_paise )",
        )
        .is("deleted_at", null),
      supabase
        .from("events")
        .select(
          "id, partner_id, name, genre, on_date, entry_paise, is_listed, photo_path, rejection_reason, partners(name)",
        )
        .is("deleted_at", null),
      supabase
        .from("trips")
        .select(
          "id, partner_id, title, duration_label, price_paise, is_listed, photo_path, rejection_reason, partners(name)",
        )
        .is("deleted_at", null),
      supabase
        .from("sailings")
        .select(
          "id, partner_id, style_label, from_island, to_island, fare_paise, is_listed, photo_path, rejection_reason, partners(name)",
        )
        .is("deleted_at", null),
      supabase
        .from("community_services")
        .select(
          "id, partner_id, name, organizer_name, on_date, is_listed, rejection_reason, partners(name)",
        )
        .is("deleted_at", null),
    ]);

  const out: PendingListing[] = [];

  type PartnerJoin = { name: string } | { name: string }[] | null;
  const partnerName = (p: PartnerJoin): string => {
    if (!p) return "Unknown business";
    return Array.isArray(p) ? (p[0]?.name ?? "Unknown business") : p.name;
  };

  for (const row of activities.data ?? []) {
    out.push({
      id: row.id as string,
      kind: "activity",
      partnerId: row.partner_id as string,
      partnerName: partnerName(row.partners as PartnerJoin),
      title: row.name as string,
      detail: `${row.category} · ₹${((row.price_paise as number) / 100).toFixed(0)}`,
      photoPath: row.photo_path as string | null,
      photos: [],
      rejectionReason: row.rejection_reason as string | null,
    });
  }
  for (const row of vehicles.data ?? []) {
    out.push({
      id: row.id as string,
      kind: "rental",
      partnerId: row.partner_id as string,
      partnerName: partnerName(row.partners as PartnerJoin),
      title: row.model as string,
      detail: `${row.type} · ₹${((row.rate_paise as number) / 100).toFixed(0)}/day · ${row.units as number} in stock`,
      photoPath: row.photo_path as string | null,
      photos: [],
      rejectionReason: row.rejection_reason as string | null,
    });
  }
  for (const row of cabs.data ?? []) {
    out.push({
      id: row.id as string,
      kind: "cab",
      partnerId: row.partner_id as string,
      partnerName: partnerName(row.partners as PartnerJoin),
      title: row.model as string,
      detail: `${row.category} · ₹${((row.full_day_paise as number) / 100).toFixed(0)}/day`,
      photoPath: row.photo_path as string | null,
      photos: [],
      rejectionReason: row.rejection_reason as string | null,
    });
  }
  for (const row of stays.data ?? []) {
    const roomTypes = (row.stay_room_types ?? []) as { nightly_rate_paise: number }[];
    const cheapest = roomTypes.length
      ? Math.min(...roomTypes.map((r) => r.nightly_rate_paise))
      : null;
    out.push({
      id: row.id as string,
      kind: "stay",
      partnerId: row.partner_id as string,
      partnerName: partnerName(row.partners as PartnerJoin),
      title: row.name as string,
      // Island is the partner's own explicit pick (100), not inherited from
      // their business profile — shown here so an admin scanning the queue
      // can catch a wrong-island listing before it ever goes live.
      detail:
        `${row.property_type} · ${islandLabel(row.island_slug as string)}` +
        (cheapest != null ? ` · ₹${(cheapest / 100).toFixed(0)}/night` : " · no room types yet"),
      photoPath: row.photo_path as string | null,
      photos: [],
      rejectionReason: row.rejection_reason as string | null,
    });
  }
  for (const row of events.data ?? []) {
    out.push({
      id: row.id as string,
      kind: "event",
      partnerId: row.partner_id as string,
      partnerName: partnerName(row.partners as PartnerJoin),
      title: row.name as string,
      detail: `${row.genre} · ${row.on_date} · ₹${((row.entry_paise as number) / 100).toFixed(0)}`,
      photoPath: row.photo_path as string | null,
      photos: [],
      rejectionReason: row.rejection_reason as string | null,
    });
  }
  for (const row of trips.data ?? []) {
    out.push({
      id: row.id as string,
      kind: "trip",
      partnerId: row.partner_id as string,
      partnerName: partnerName(row.partners as PartnerJoin),
      title: row.title as string,
      detail: `${row.duration_label} · ₹${((row.price_paise as number) / 100).toFixed(0)}`,
      photoPath: row.photo_path as string | null,
      photos: [],
      rejectionReason: row.rejection_reason as string | null,
    });
  }
  for (const row of sailings.data ?? []) {
    out.push({
      id: row.id as string,
      kind: "ferry",
      partnerId: row.partner_id as string,
      partnerName: partnerName(row.partners as PartnerJoin),
      title: row.style_label as string,
      detail: `${islandLabel(row.from_island as string)} → ${islandLabel(row.to_island as string)} · ₹${((row.fare_paise as number) / 100).toFixed(0)}`,
      photoPath: row.photo_path as string | null,
      photos: [],
      rejectionReason: row.rejection_reason as string | null,
    });
  }
  for (const row of communityServices.data ?? []) {
    out.push({
      id: row.id as string,
      kind: "community",
      partnerId: row.partner_id as string,
      partnerName: partnerName(row.partners as PartnerJoin),
      title: row.name as string,
      detail: `${row.organizer_name} · ${row.on_date}`,
      photoPath: null,
      photos: [],
      rejectionReason: row.rejection_reason as string | null,
    });
  }

  // Galleries for everything we're about to return. Admins can read
  // listing_photos for pending rows too ("admins see all listing photos", 037),
  // so this uses the same server client rather than the catalogue one.
  const photoRows = out.length
    ? (
        await supabase
          .from("listing_photos")
          .select("listing_kind, listing_id, storage_path, sort_order")
          .in("listing_id", out.map((l) => l.id))
          .order("sort_order")
      ).data ?? []
    : [];
  const galleries = new Map<string, string[]>();
  for (const r of photoRows as { listing_kind: string; listing_id: string; storage_path: string }[]) {
    const key = `${r.listing_kind}-${r.listing_id}`;
    const arr = galleries.get(key) ?? [];
    arr.push(listingPhotoUrl(r.storage_path));
    galleries.set(key, arr);
  }
  for (const l of out) l.photos = galleries.get(`${l.kind}-${l.id}`) ?? [];

  const isListedByKindId = new Map<string, boolean>();
  for (const row of activities.data ?? []) isListedByKindId.set(`activity-${row.id}`, row.is_listed as boolean);
  for (const row of vehicles.data ?? []) isListedByKindId.set(`rental-${row.id}`, row.is_listed as boolean);
  for (const row of cabs.data ?? []) isListedByKindId.set(`cab-${row.id}`, row.is_listed as boolean);
  for (const row of stays.data ?? []) isListedByKindId.set(`stay-${row.id}`, row.is_listed as boolean);
  for (const row of events.data ?? []) isListedByKindId.set(`event-${row.id}`, row.is_listed as boolean);
  for (const row of trips.data ?? []) isListedByKindId.set(`trip-${row.id}`, row.is_listed as boolean);
  for (const row of sailings.data ?? []) isListedByKindId.set(`ferry-${row.id}`, row.is_listed as boolean);
  for (const row of communityServices.data ?? [])
    isListedByKindId.set(`community-${row.id}`, row.is_listed as boolean);

  const bucketed = out.filter((item) => {
    const isListed = isListedByKindId.get(`${item.kind}-${item.id}`) ?? false;
    if (filter === "all") return true;
    if (filter === "pending") return !isListed && !item.rejectionReason;
    return !isListed && !!item.rejectionReason; // rejected
  });

  return bucketed;
}

export async function approveListing(kind: ListingKind, id: string): Promise<AdminActionResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("admin_approve_listing", { p_kind: kind, p_id: id });
  if (error) return { ok: false, message: GENERIC_FAILURE };
  const row = firstRow<{ ok: boolean; message: string }>(data);
  if (!row?.ok) return { ok: false, message: row?.message ?? GENERIC_FAILURE };
  return { ok: true, message: row.message };
}

export async function rejectListing(kind: ListingKind, id: string, reason: string): Promise<AdminActionResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("admin_reject_listing", {
    p_kind: kind,
    p_id: id,
    p_reason: reason,
  });
  if (error) return { ok: false, message: GENERIC_FAILURE };
  const row = firstRow<{ ok: boolean; message: string }>(data);
  if (!row?.ok) return { ok: false, message: row?.message ?? GENERIC_FAILURE };
  return { ok: true, message: row.message };
}


// ---------------------------------------------------------------------------
// One listing, everything about it, for the review screen. listListings()
// answers "what's in the queue"; this answers "should this specific thing go
// live" — the description, the price, the photos, the timetable, the partner
// it belongs to. Admins can select any catalogue row ("admins see all X",
// 012/016), so these are plain selects keyed on id, same column lists as the
// getOwn* reads in lib/partner-register.ts.
// ---------------------------------------------------------------------------

export type ScheduleLine = { time: string; capacity: number | null; days: string };

export type ListingReview = {
  kind: ListingKind;
  id: string;
  title: string;
  isListed: boolean;
  rejectionReason: string | null;
  partner: { id: string; name: string; status: string };
  photos: string[];
  rows: { label: string; value: string }[];
  /** null = this kind has no separate timetable; [] = it has one and it's
   *  empty (blocks approval, 038); otherwise the lines. */
  schedule: ScheduleLine[] | null;
};

const RUPEE = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN")}`;
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const clock = (mins: number) =>
  `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
const daysLabel = (days: number[]) =>
  days.length >= 7 ? "Every day" : [...days].sort((a, b) => a - b).map((d) => DOW[d]).join(", ");

type PartnerJoinOne = { id: string; name: string; status: string } | { id: string; name: string; status: string }[] | null;
const onePartner = (p: PartnerJoinOne) => {
  const row = Array.isArray(p) ? p[0] : p;
  return row ?? { id: "", name: "Unknown business", status: "pending" };
};

const REVIEW_TABLE: Record<ListingKind, string> = {
  activity: "activities",
  rental: "vehicles",
  cab: "cabs",
  stay: "stays",
  event: "events",
  trip: "trips",
  ferry: "sailings",
  community: "community_services",
};

export async function getListingForReview(
  kind: ListingKind,
  id: string,
): Promise<ListingReview | null> {
  const supabase = await supabaseServer();

  const { data, error } =
    kind === "stay"
      ? await supabase
          .from(REVIEW_TABLE[kind])
          .select(
            "*, partners ( id, name, status ), stay_room_types ( id, code, name, max_guests, bedrooms, beds, bathrooms, nightly_rate_paise, quantity )",
          )
          .eq("id", id)
          .maybeSingle()
      : await supabase.from(REVIEW_TABLE[kind]).select("*, partners ( id, name, status )").eq("id", id).maybeSingle();

  if (error || !data) return null;
  const d = data as unknown as Record<string, unknown>;
  const partner = onePartner(d.partners as PartnerJoinOne);

  const num = (k: string) => Number(d[k] ?? 0);
  const str = (k: string) => String(d[k] ?? "");
  const arr = (k: string) => (Array.isArray(d[k]) ? (d[k] as unknown[]).map(String) : []);
  /** Unlike num(), doesn't collapse a genuinely-null column (an uncapped
   *  capacity/seat count, 089) down to 0. */
  const numOrNull = (k: string) => (d[k] == null ? null : Number(d[k]));

  let title = "";
  let rows: { label: string; value: string }[] = [];

  if (kind === "activity") {
    title = str("name");
    rows = [
      { label: "Category", value: str("category") },
      { label: "Price", value: `${RUPEE(num("price_paise"))} / person` },
      { label: "Summary", value: str("summary") },
      { label: "About", value: str("about") },
    ];
  } else if (kind === "rental") {
    title = str("model");
    rows = [
      { label: "Type", value: str("type") },
      { label: "Rate", value: `${RUPEE(num("rate_paise"))} / day` },
      { label: "Seats", value: String(num("seats")) },
      { label: "In stock", value: String(num("units")) },
      { label: "Security deposit", value: num("security_deposit_paise") ? RUPEE(num("security_deposit_paise")) : "None" },
      { label: "Notes", value: str("meta") },
    ];
  } else if (kind === "cab") {
    title = str("model");
    rows = [
      { label: "Category", value: str("category") },
      { label: "Seats", value: String(num("seats")) },
      { label: "Fuel", value: str("fuel") },
      { label: "Board number", value: str("board_number") || "—" },
      { label: "Full day", value: `${RUPEE(num("full_day_paise"))} / day` },
      { label: "Airport surcharge", value: num("airport_surcharge_paise") ? RUPEE(num("airport_surcharge_paise")) : "None" },
      { label: "Night surcharge", value: num("night_surcharge_paise") ? RUPEE(num("night_surcharge_paise")) : "None" },
      { label: "Notes", value: str("meta") },
    ];
  } else if (kind === "stay") {
    title = str("name");
    const roomTypes = (Array.isArray(d.stay_room_types) ? d.stay_room_types : []) as Record<
      string,
      unknown
    >[];
    rows = [
      { label: "Property type", value: str("property_type") },
      // The partner's own explicit pick (100) — worth its own row, since a
      // wrong-island listing is exactly the mistake this screen exists to
      // catch before approval.
      { label: "Island", value: islandLabel(str("island_slug")) },
      { label: "Area", value: str("area") },
      { label: "Tagline", value: str("tagline") },
      { label: "Amenities", value: arr("amenities").join(", ") || "—" },
      { label: "House rules", value: str("house_rules") },
      { label: "Cancellation policy", value: str("cancellation_policy") },
      { label: "Check-in", value: clock(num("check_in_mins")) },
      { label: "Check-out", value: clock(num("check_out_mins")) },
      { label: "About", value: str("about") },
      ...roomTypes.map((r) => ({
        label: `Room type — ${String(r.name ?? "")}`,
        value:
          `${RUPEE(Number(r.nightly_rate_paise ?? 0))}/night · sleeps ${Number(r.max_guests ?? 0)}` +
          ` · ${Number(r.bedrooms ?? 0)} bed${Number(r.bedrooms ?? 0) === 1 ? "room" : "rooms"}` +
          ` · ${Number(r.quantity ?? 1)} unit${Number(r.quantity ?? 1) === 1 ? "" : "s"}`,
      })),
    ];
  } else if (kind === "event") {
    title = str("name");
    rows = [
      { label: "Type", value: GENRE_LABEL[str("genre") as Genre] ?? str("genre") },
      { label: "Venue", value: `${str("venue")} · ${str("area")}` },
      { label: "Island", value: islandLabel(str("island_slug")) },
      { label: "Map link", value: str("maps_url") || "—" },
      {
        label: "When",
        value: `${str("on_date")} at ${clock(num("time_mins"))}${
          numOrNull("end_time_mins") != null ? `–${clock(numOrNull("end_time_mins")!)}` : ""
        }`,
      },
      { label: "Entry", value: num("entry_paise") ? RUPEE(num("entry_paise")) : "Free" },
      { label: "Capacity", value: numOrNull("capacity") != null ? String(numOrNull("capacity")) : "Uncapped" },
      { label: "About", value: str("about") },
    ];
  } else if (kind === "trip") {
    title = str("title");
    rows = [
      { label: "Host", value: `${str("host_name")}${str("host_since") ? ` · since ${str("host_since")}` : ""}` },
      { label: "Duration", value: str("duration_label") },
      {
        label: "Runs",
        value:
          arr("run_dates").length > 0
            ? arr("run_dates").join(", ")
            : daysLabel((d.runs_on_days as number[]) ?? []),
      },
      {
        label: "Pickup time",
        value: `${clock(num("departs_mins"))}${
          numOrNull("ends_mins") != null ? ` – back by ~${clock(numOrNull("ends_mins")!)}` : ""
        }`,
      },
      { label: "Price", value: `${RUPEE(num("price_paise"))} / seat` },
      { label: "Difficulty", value: str("difficulty") },
      {
        label: "Seats",
        value: `${num("min_seats")} to run, ${
          numOrNull("seats_total") != null ? `${numOrNull("seats_total")} total` : "no limit"
        }`,
      },
      {
        label: "Meeting point",
        value: d.meet_at_hotel
          ? "Hotel pickup — traveller enters their address at booking"
          : str("meet_point"),
      },
      ...(d.meet_at_hotel ? [] : [{ label: "Map link", value: str("maps_url") || "—" }]),
      { label: "Includes", value: arr("includes").join(", ") || "—" },
      { label: "What to bring", value: arr("bring_list").join(", ") || "—" },
      { label: "Summary", value: str("summary") },
    ];
  } else if (kind === "community") {
    title = str("name");
    const ageLimit =
      d.min_age != null && d.max_age != null
        ? `${num("min_age")}–${num("max_age")}`
        : d.min_age != null
          ? `${num("min_age")}+`
          : d.max_age != null
            ? `up to ${num("max_age")}`
            : "None";
    rows = [
      { label: "Organiser / NGO", value: str("organizer_name") },
      { label: "Island", value: islandLabel(str("island_slug")) },
      {
        label: "When",
        value: `${str("on_date")} at ${clock(num("time_mins"))}${
          numOrNull("end_time_mins") != null ? `–${clock(numOrNull("end_time_mins")!)}` : ""
        }`,
      },
      { label: "Meeting point", value: str("meeting_point") },
      { label: "Map link", value: str("maps_url") || "—" },
      { label: "What to bring", value: str("what_to_bring") || "—" },
      { label: "Safety notes", value: str("safety_notes") || "—" },
      { label: "Age limits", value: ageLimit },
      { label: "Primary contact", value: `${str("contact_name")} · ${str("contact_phone")}` },
      { label: "WhatsApp group", value: str("whatsapp_group_url") || "—" },
      { label: "About", value: str("about") },
    ];
  } else {
    // ferry
    title = str("style_label");
    rows = [
      { label: "Route", value: `${islandLabel(str("from_island"))} → ${islandLabel(str("to_island"))}` },
      { label: "Departs", value: `${clock(num("dep_mins"))}, ${num("duration_mins")} min crossing` },
      { label: "Fare", value: RUPEE(num("fare_paise")) },
      { label: "Capacity", value: String(num("capacity")) },
      { label: "Runs", value: daysLabel((d.days_of_week as number[]) ?? []) },
      { label: "Notice", value: str("info") || "—" },
    ];
  }

  const photoRows = (
    await supabase
      .from("listing_photos")
      .select("storage_path, sort_order")
      .eq("listing_kind", kind)
      .eq("listing_id", id)
      .order("sort_order")
  ).data;
  const photos = ((photoRows ?? []) as { storage_path: string }[]).map((r) =>
    listingPhotoUrl(r.storage_path),
  );

  let schedule: ScheduleLine[] | null = null;
  if (kind === "activity") {
    const table = "activity_schedule";
    const fk = "activity_id";
    const capCol = "capacity";
    const { data: sched } = await supabase
      .from(table)
      .select(`time_mins, end_time_mins, days_of_week, ${capCol}`)
      .eq(fk, id)
      .order("time_mins");
    schedule = ((sched ?? []) as Record<string, unknown>[]).map((s) => ({
      time:
        s.end_time_mins != null
          ? `${clock(Number(s.time_mins))}–${clock(Number(s.end_time_mins))}`
          : clock(Number(s.time_mins)),
      capacity: s[capCol] == null ? null : Number(s[capCol]),
      days: daysLabel((s.days_of_week as number[]) ?? []),
    }));
  }

  return {
    kind,
    id,
    title,
    isListed: Boolean(d.is_listed),
    rejectionReason: (d.rejection_reason as string | null) ?? null,
    partner: { id: partner.id, name: partner.name, status: partner.status },
    photos,
    rows: rows.map((r) => ({ label: r.label, value: r.value.trim() || "—" })),
    schedule,
  };
}


// ---------------------------------------------------------------------------
// Managing a business that is already in — 018.
//
// The three above (approve/reject a partner, approve/reject a listing) are
// all about the front door. These are about everything after it: a live
// business that has to come down, one that can come back, and a live listing
// that turned out to be wrong. Same thin-wrapper shape — the RPC re-checks
// is_admin() itself and enforces the reason at the database level, so this
// file stays a translation layer and never a security boundary.
// ---------------------------------------------------------------------------

export async function suspendPartner(partnerId: string, reason: string): Promise<AdminActionResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("admin_suspend_partner", {
    p_partner_id: partnerId,
    p_reason: reason,
  });
  if (error) return { ok: false, message: GENERIC_FAILURE };
  const row = firstRow<{ ok: boolean; message: string }>(data);
  if (!row?.ok) return { ok: false, message: row?.message ?? GENERIC_FAILURE };
  return { ok: true, message: row.message };
}

export async function reactivatePartner(partnerId: string): Promise<AdminActionResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("admin_reactivate_partner", {
    p_partner_id: partnerId,
  });
  if (error) return { ok: false, message: GENERIC_FAILURE };
  const row = firstRow<{ ok: boolean; message: string }>(data);
  if (!row?.ok) return { ok: false, message: row?.message ?? GENERIC_FAILURE };
  return { ok: true, message: row.message };
}

/** Permanent — the business drops off every list this file's readers show,
 *  and there is no reactivate path back (093). The row itself, and every
 *  booking that ever pointed at it, stay in the database untouched. */
export async function deletePartner(partnerId: string, reason: string): Promise<AdminActionResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("admin_delete_partner", {
    p_partner_id: partnerId,
    p_reason: reason,
  });
  if (error) return { ok: false, message: GENERIC_FAILURE };
  const row = firstRow<{ ok: boolean; message: string }>(data);
  if (!row?.ok) return { ok: false, message: row?.message ?? GENERIC_FAILURE };
  return { ok: true, message: row.message };
}

export async function unlistListing(
  kind: ListingKind,
  id: string,
  reason: string,
): Promise<AdminActionResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("admin_unlist_listing", {
    p_kind: kind,
    p_id: id,
    p_reason: reason,
  });
  if (error) return { ok: false, message: GENERIC_FAILURE };
  const row = firstRow<{ ok: boolean; message: string }>(data);
  if (!row?.ok) return { ok: false, message: row?.message ?? GENERIC_FAILURE };
  return { ok: true, message: row.message };
}

/** Permanent, from any state — pending, live or already rejected. Drops out
 *  of listListings() entirely (deleted_at, 093) rather than moving to
 *  another bucket, and there's no resubmit back from it. The row and any
 *  bookings against it are untouched. */
export async function deleteListing(
  kind: ListingKind,
  id: string,
  reason: string,
): Promise<AdminActionResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("admin_delete_listing", {
    p_kind: kind,
    p_id: id,
    p_reason: reason,
  });
  if (error) return { ok: false, message: GENERIC_FAILURE };
  const row = firstRow<{ ok: boolean; message: string }>(data);
  if (!row?.ok) return { ok: false, message: row?.message ?? GENERIC_FAILURE };
  return { ok: true, message: row.message };
}

/** One business, for its own detail page. Null when the id doesn't exist. */
export async function getPartner(partnerId: string): Promise<PendingPartner | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("partners")
    .select(
      "id, name, kind, island_slug, contact_phone, address, maps_url, cover_photo_path, license_number, license_doc_path, status, rejection_reason, created_at, commission_bps",
    )
    .eq("id", partnerId)
    .maybeSingle();

  if (error || !data) return null;

  return {
    id: data.id,
    name: data.name,
    kindLabel: PARTNER_KIND_LABEL[data.kind as PartnerKind] ?? data.kind,
    islandSlug: data.island_slug,
    contactPhone: data.contact_phone,
    address: data.address,
    mapsUrl: data.maps_url,
    coverPhotoPath: data.cover_photo_path,
    licenseNumber: data.license_number,
    licenseDocPath: data.license_doc_path,
    status: data.status,
    rejectionReason: data.rejection_reason,
    createdAt: data.created_at,
    commissionBps: data.commission_bps,
  };
}

// ---------------------------------------------------------------------------
// Everything one business has listed, whatever state it's in.
//
// listListings() above answers "what needs reviewing, across everyone";
// this answers "what does THIS business have", which is the question a
// partner detail page asks. Same seven tables, so it reuses listListings()
// and filters rather than writing the seven selects a second time — one
// place to change when an eighth catalogue kind arrives.
// ---------------------------------------------------------------------------

export type PartnerListing = PendingListing & { isListed: boolean };

export async function listListingsForPartner(partnerId: string): Promise<PartnerListing[]> {
  const [all, pending, rejected] = await Promise.all([
    listListings("all"),
    listListings("pending"),
    listListings("rejected"),
  ]);

  const down = new Set([...pending, ...rejected].map((l) => `${l.kind}-${l.id}`));

  return all
    .filter((l) => l.partnerId === partnerId)
    .map((l) => ({ ...l, isListed: !down.has(`${l.kind}-${l.id}`) }));
}

/** The numbers the console's nav badges and Overview need. */
export async function countsWaiting(): Promise<{
  partners: number;
  listings: number;
  support: number;
  cabDispatch: number;
  reports: number;
}> {
  const supabase = await supabaseServer();
  const [partners, listings, support, cabDispatch, reports] = await Promise.all([
    listPartners("pending"),
    listListings("pending"),
    supabase.from("admin_support_threads").select("partner_id").gt("partner_unread", 0),
    countCabsToAssign(),
    supabase.from("admin_message_reports").select("id", { count: "exact", head: true }).eq("status", "open"),
  ]);
  return {
    partners: partners.length,
    listings: listings.length,
    support: (support.data ?? []).length,
    cabDispatch,
    reports: reports.count ?? 0,
  };
}
