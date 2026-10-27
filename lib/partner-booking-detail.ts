// One booking, in full — for the partner's booking detail page.
//
// Reuses getPartnerBookings() rather than re-querying: the list is small and
// already partner-scoped, so the detail is "find this item, plus its
// siblings on the same reference, plus the message thread". A sibling is
// another booking_item this same partner is running under the one reference
// (a traveller who booked two dives that day) — partner_bookings doesn't
// expose booking_id, but ref_code is unique per booking, so it groups fine.

import { getPartnerBookings, type PartnerBooking } from "./partner-bookings";
import { supabaseServer } from "./supabase-server";
import { istStampLabel } from "./partner-format";
import type { Directions } from "./bookings";

export type ThreadMessage = {
  id: string;
  fromPartner: boolean;
  body: string;
  stampLabel: string;
  createdAtIso: string;
};

export type EventGuestRow = {
  fullName: string;
  age: number;
  /** Everyone over lib/events.ts's FREE_UNDER_AGE needed a ticket; kids at or
   *  under it came along free and aren't part of the item's `party`. */
  ticketed: boolean;
};

export type TripTravellerRow = {
  fullName: string;
  age: number;
};

export type ActivityGuestRow = {
  fullName: string;
  age: number;
};

export type PartnerBookingDetail = {
  item: PartnerBooking;
  siblings: PartnerBooking[];
  thread: ThreadMessage[];
  /** Who's actually coming — only fetched for kind 'event' (053). */
  eventGuests: EventGuestRow[] | null;
  /** Who's actually going — only fetched for kind 'trip' (056). */
  tripTravellers: TripTravellerRow[] | null;
  /** Where to collect the traveller for a hotel-pickup trip (076), or where
   *  to drop off a "deliver to my hotel" rental (147) — never both, since a
   *  partner only ever runs one kind. */
  pickupAddress: string | null;
  /** Who's actually on it — only fetched for kind 'activity' (068). */
  activityGuests: ActivityGuestRow[] | null;
  /** Route + exact pickup pin for a cab booking (048/077/081) — only fetched
   *  for kind 'cab', once this operator's car has actually been attached
   *  (the operator only sees a booking after admin_assign_cab_operator, 082,
   *  or an existing marketplace booking made directly with them). */
  cabPickup: CabPickupInfo | null;
  /** null = the message thread is open, else who closed it (152) — "partner"
   *  means this business blocked it themselves; "traveller" means the
   *  traveller did. */
  threadBlockedBy: "traveller" | "partner" | null;
};

export type CabPickupInfo = {
  routeLabel: string;
  pickupNote: string;
  /** Ready for DirectionsButton — the traveller's own GPS pin (081) when
   *  they shared one, else a plain search on the named destination. */
  directions: Directions;
};

const FREE_UNDER_AGE = 3;

async function getEventGuests(itemId: string): Promise<EventGuestRow[]> {
  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from("event_guests")
    .select("full_name, age")
    .eq("booking_item_id", itemId)
    .order("age", { ascending: false });

  if (error || !data) return [];

  return data.map((row) => ({
    fullName: row.full_name as string,
    age: row.age as number,
    ticketed: (row.age as number) > FREE_UNDER_AGE,
  }));
}

async function getTripTravellers(itemId: string): Promise<TripTravellerRow[]> {
  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from("trip_travellers")
    .select("full_name, age")
    .eq("booking_item_id", itemId)
    .order("age", { ascending: false });

  if (error || !data) return [];

  return data.map((row) => ({
    fullName: row.full_name as string,
    age: row.age as number,
  }));
}

async function getPickupAddress(itemId: string): Promise<string | null> {
  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from("booking_items")
    .select("pickup_address")
    .eq("id", itemId)
    .maybeSingle();

  if (error || !data) return null;
  return (data.pickup_address as string | null) ?? null;
}

async function getCabPickup(itemId: string): Promise<CabPickupInfo | null> {
  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from("cab_trip_details")
    .select("trip_type, from_place_id, to_place_id, pickup_note, pickup_lat, pickup_lng, days")
    .eq("item_id", itemId)
    .maybeSingle();

  if (error || !data) return null;

  // cab_places is a small, admin-maintained list — resolved by id here
  // rather than an embedded join, the same trade lib/cabs.ts and
  // admin-bookings.ts make.
  const { getCabPlaces } = await import("./cabs");
  const places = await getCabPlaces();
  const label = (id: unknown) => places.find((p) => p.id === id)?.label ?? null;

  const from = label(data.from_place_id);
  const to = label(data.to_place_id);
  const days = data.days as number;
  const routeLabel =
    data.trip_type === "outstation"
      ? `${to ?? "Multi-day trip"} · ${days} day${days === 1 ? "" : "s"}`
      : `${from ?? "Standard city pickup"} → ${to ?? "Local hop"}`;

  const lat = data.pickup_lat as number | null;
  const lng = data.pickup_lng as number | null;
  const pinned = lat != null && lng != null;

  return {
    routeLabel,
    pickupNote: (data.pickup_note as string | null) ?? "",
    directions: {
      addressLabel: pinned ? "Traveller's exact pin" : to,
      query: to ?? from ?? "Andaman Islands",
      mapsUrl: pinned ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}` : null,
    },
  };
}

async function getActivityGuests(itemId: string): Promise<ActivityGuestRow[]> {
  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from("activity_guests")
    .select("full_name, age")
    .eq("booking_item_id", itemId)
    .order("age", { ascending: false });

  if (error || !data) return [];

  return data.map((row) => ({
    fullName: row.full_name as string,
    age: row.age as number,
  }));
}

export async function getBookingThread(itemId: string): Promise<ThreadMessage[]> {
  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from("booking_messages")
    .select("id, sender, body, created_at")
    .eq("item_id", itemId)
    .order("created_at", { ascending: true });

  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id as string,
    fromPartner: row.sender === "partner",
    body: row.body as string,
    stampLabel: istStampLabel(row.created_at as string),
    createdAtIso: row.created_at as string,
  }));
}

async function getThreadBlockedBy(itemId: string): Promise<"traveller" | "partner" | null> {
  const supabase = await supabaseServer();
  const { data } = await supabase.rpc("partner_thread_status", { p_item_id: itemId });
  const row = Array.isArray(data) ? (data[0] as { blocked_by: string | null }) : null;
  return (row?.blocked_by as "traveller" | "partner" | null) ?? null;
}

export async function getPartnerBookingDetail(
  itemId: string,
): Promise<PartnerBookingDetail | null> {
  const [bookings, thread, threadBlockedBy] = await Promise.all([
    getPartnerBookings(),
    getBookingThread(itemId),
    getThreadBlockedBy(itemId),
  ]);

  const item = bookings.find((b) => b.itemId === itemId);
  if (!item) return null;

  const siblings = bookings.filter(
    (b) => b.refCode === item.refCode && b.itemId !== itemId,
  );

  const eventGuests = item.kind === "event" ? await getEventGuests(itemId) : null;
  const tripTravellers = item.kind === "trip" ? await getTripTravellers(itemId) : null;
  const pickupAddress =
    item.kind === "trip" || item.kind === "rental" ? await getPickupAddress(itemId) : null;
  const activityGuests = item.kind === "activity" ? await getActivityGuests(itemId) : null;
  const cabPickup = item.kind === "cab" ? await getCabPickup(itemId) : null;

  return {
    item,
    siblings,
    thread,
    threadBlockedBy,
    eventGuests,
    tripTravellers,
    pickupAddress,
    activityGuests,
    cabPickup,
  };
}
