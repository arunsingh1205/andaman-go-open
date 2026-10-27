"use server";

// Every booking on the platform, from the admin console.
//
// The third view of the same rows. lib/bookings.ts groups by DAY, because a
// traveller holds one reference for a whole day out. lib/partner-bookings.ts
// gives one row per THING, because that's what a business actually has to
// run. This one is also one row per thing, but across every business at
// once — the question an admin asks is "what is happening on the platform",
// not "what am I running today".
//
// Reads admin_bookings (018), which is scoped by an explicit is_admin()
// filter inside the view itself, on top of the two "admins see all …"
// policies underneath it. Nothing here re-checks that, and nothing here
// needs to: a non-admin querying this gets an empty list, not an error.

import { instantIso, dayKey, fmtClock, todayIST, addDays } from "./date";
import { supabaseServer } from "./supabase-server";
import { refundPayment } from "./razorpay";
import { dateLabelFor, istDayKey, istMinutes, partyLabel } from "./partner-format";
import type { BookingKind, BookingState } from "./bookings";

export type AdminBooking = {
  itemId: string;
  refCode: string;
  partnerId: string;
  partnerName: string;
  partnerStatus: "pending" | "approved" | "suspended" | "rejected";
  islandSlug: string;
  kind: BookingKind;
  title: string;
  startsAtIso: string;
  dateLabel: string;
  timeLabel: string;
  detail: string;
  pricePaise: number;
  state: BookingState;
  ticket: string | null;
  redeemedAt: string | null;
  cancelledNote: string | null;
  /** Only ever set by a rate-card cab booking (088) — the traveller's own
   *  name, typed at checkout, so whoever calls them knows who they're
   *  asking for. Null for every other booking kind. */
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  when: "today" | "upcoming" | "past";
  /** Where a real Razorpay refund actually stands — null when nothing was
   *  ever charged online for this item (cash booking, deposit forfeited,
   *  etc), so there's nothing for a gateway to reverse. */
  refundStatus: "processing" | "processed" | "failed" | null;
  /** Only meaningful for kind 'cab'. Set once a car is attached — either
   *  chosen at booking time by the marketplace flow (048), or by dispatch
   *  assigning one of the same operators' cars to a rate-card booking
   *  (077/082). Null means it's still waiting on dispatch. */
  cabId: string | null;
};

/** Which slice of the calendar a screen is asking for. */
export type BookingWindow = "today" | "upcoming" | "past" | "all";

export type BookingFilters = {
  window?: BookingWindow;
  state?: BookingState | "all";
  partnerId?: string;
  islandSlug?: string;
  /** Matches a reference code, a traveller's phone, or the thing booked. */
  search?: string;
};

type Row = {
  item_id: string;
  ref_code: string;
  partner_id: string;
  partner_name: string;
  partner_status: "pending" | "approved" | "suspended" | "rejected";
  island_slug: string;
  kind: BookingKind;
  title: string | null;
  starts_at: string;
  party: number;
  units: number;
  price_paise: number;
  state: BookingState;
  ticket_code: string | null;
  redeemed_at: string | null;
  cancelled_note: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  refund_status: "processing" | "processed" | "failed" | null;
  cab_id: string | null;
};

// A hard ceiling so one runaway query can never try to render the whole
// platform's history into a table. Andaman Go is nowhere near this today;
// it's here so the screen degrades predictably rather than hanging when it
// eventually is.
const MAX_ROWS = 500;

export async function getAdminBookings(filters: BookingFilters = {}): Promise<AdminBooking[]> {
  const supabase = await supabaseServer();
  const today = todayIST();
  const todayKey = dayKey(today);

  let query = supabase.from("admin_bookings").select("*");

  // Date windows are done in SQL rather than in JS, so the row cap above
  // applies to the slice being asked for instead of chopping an arbitrary
  // 500 rows out of all time and then filtering those down to nothing.
  const startOfToday = instantIso(todayKey, 0);
  const startOfTomorrow = instantIso(dayKey(addDays(today, 1)), 0);

  if (filters.window === "today") {
    query = query.gte("starts_at", startOfToday).lt("starts_at", startOfTomorrow);
  } else if (filters.window === "upcoming") {
    query = query.gte("starts_at", startOfToday);
  } else if (filters.window === "past") {
    query = query.lt("starts_at", startOfToday);
  }

  if (filters.state && filters.state !== "all") query = query.eq("state", filters.state);
  if (filters.partnerId) query = query.eq("partner_id", filters.partnerId);
  if (filters.islandSlug) query = query.eq("island_slug", filters.islandSlug);

  // Past reads newest-first (what just happened matters most); everything
  // else reads soonest-first (what's coming matters most).
  query = query
    .order("starts_at", { ascending: filters.window !== "past" })
    .limit(MAX_ROWS);

  const { data, error } = await query;
  if (error) {
    throw new Error(`Supabase: could not load bookings — ${error.message}`);
  }

  const rows = (data ?? []) as unknown as Row[];

  const mapped: AdminBooking[] = rows.map((row) => {
    const onKey = istDayKey(row.starts_at);
    return {
      itemId: row.item_id,
      refCode: row.ref_code,
      partnerId: row.partner_id,
      partnerName: row.partner_name,
      partnerStatus: row.partner_status,
      islandSlug: row.island_slug,
      kind: row.kind,
      title: row.title ?? "Booking",
      startsAtIso: row.starts_at,
      dateLabel: dateLabelFor(row.starts_at, today),
      timeLabel: fmtClock(istMinutes(row.starts_at)),
      detail: partyLabel(row.kind, row.party, row.units),
      pricePaise: row.price_paise,
      state: row.state,
      ticket: row.ticket_code,
      redeemedAt: row.redeemed_at,
      cancelledNote: row.cancelled_note,
      contactName: row.contact_name,
      contactPhone: row.contact_phone,
      contactEmail: row.contact_email,
      when: onKey === todayKey ? "today" : onKey > todayKey ? "upcoming" : "past",
      refundStatus: row.refund_status,
      cabId: row.cab_id,
    };
  });

  // Search is the one filter left in JS: it spans a reference code, a phone
  // number and a listing title, and pushing that into PostgREST would mean
  // an `or=` string built from user input — readable here, fiddly and
  // easy to get wrong there, for a list already capped at 500 rows.
  const term = filters.search?.trim().toLowerCase();
  if (!term) return mapped;

  return mapped.filter(
    (b) =>
      b.refCode.toLowerCase().includes(term) ||
      b.partnerName.toLowerCase().includes(term) ||
      b.title.toLowerCase().includes(term) ||
      (b.contactName ?? "").toLowerCase().includes(term) ||
      (b.contactPhone ?? "").toLowerCase().includes(term) ||
      (b.contactEmail ?? "").toLowerCase().includes(term) ||
      (b.ticket ?? "").toLowerCase().includes(term),
  );
}

export type AdminActionResult = { ok: true; message: string } | { ok: false; message: string };

/**
 * Cancel a booking on a partner's behalf — admin_cancel_booking (018).
 *
 * The reason is not optional and not decorative: the partner will find a
 * booking they'd confirmed sitting as refunded, and this note is the only
 * record of who did that and why. The database refuses an empty one too, so
 * a UI bug can't quietly skip it.
 */
export async function cancelBookingAsAdmin(
  itemId: string,
  reason: string,
): Promise<AdminActionResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("admin_cancel_booking", {
    p_item_id: itemId,
    p_reason: reason,
  });
  if (error) return { ok: false, message: "Something went wrong. Try again." };

  const row = Array.isArray(data) && data.length > 0
    ? (data[0] as {
        ok: boolean;
        message: string;
        razorpay_payment_id: string | null;
        refund_paise: number | null;
      })
    : null;
  if (!row?.ok) return { ok: false, message: row?.message ?? "Something went wrong. Try again." };

  // Admin cancels refund the traveller in full (018) — actually tell
  // Razorpay, same as a traveller's own cancellation (067).
  if (row.razorpay_payment_id && row.refund_paise && row.refund_paise > 0) {
    const refund = await refundPayment(row.razorpay_payment_id, row.refund_paise);
    if (refund) {
      await supabase.rpc("record_razorpay_refund", {
        p_item_id: itemId,
        p_razorpay_refund_id: refund.id,
        p_status: "processing",
      });
    }
  }

  return { ok: true, message: row.message };
}

// ---------------------------------------------------------------------------
// Ferry bookings — placement (039).
//
// There is no operator API yet, so a paid ferry booking has no ticket_code
// until someone books it with Makruzz / Nautika / Green Ocean and records the
// PNR. These reads and the one write are what the /admin bookings screen uses
// to work that queue.
// ---------------------------------------------------------------------------

export type AdminFerryPassenger = {
  fullName: string;
  age: number;
  gender: string;
  nationality: string;
  idType: string;
  idNumber: string;
};

export async function getFerryPassengers(itemId: string): Promise<AdminFerryPassenger[]> {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("ferry_passengers")
    .select("full_name, age, gender, nationality, id_type, id_number")
    .eq("booking_item_id", itemId)
    .order("created_at");

  return (data ?? []).map((p) => ({
    fullName: p.full_name as string,
    age: p.age as number,
    gender: p.gender as string,
    nationality: p.nationality as string,
    idType: p.id_type as string,
    idNumber: p.id_number as string,
  }));
}

export async function placeFerryBooking(itemId: string, pnr: string): Promise<AdminActionResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("admin_place_ferry_booking", {
    p_item_id: itemId,
    p_pnr: pnr,
  });
  if (error) return { ok: false, message: "Something went wrong. Try again." };
  const row = Array.isArray(data) && data.length > 0 ? (data[0] as { ok: boolean; message: string }) : null;
  if (!row?.ok) return { ok: false, message: row?.message ?? "Something went wrong. Try again." };
  return { ok: true, message: row.message };
}

/** How many paid ferry bookings still need placing with the operator. */
export async function countFerryToPlace(): Promise<number> {
  const supabase = await supabaseServer();
  const { count } = await supabase
    .from("admin_bookings")
    .select("item_id", { count: "exact", head: true })
    .eq("kind", "ferry")
    .is("ticket_code", null)
    .neq("state", "refunded");
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Rate-card cab bookings — dispatch (077/078/082).
//
// A rate-card booking is paid and real, just waiting on a car: it sits with
// cab_id null and ticket_code null until admin_assign_cab_operator hands it
// to one of the existing marketplace's cars (048) — a driver here is a real
// partner account, not a contact record, so assigning one re-points the
// booking's partner_id/subject_id and it shows up in that operator's own
// dashboard from then on. The read here is the context an admin actually
// needs to make that call — the route, the pickup time, the vehicle class
// the fare assumes, and the traveller's own GPS pin if they shared one (081).
// ---------------------------------------------------------------------------

export type CabDispatchDetail = {
  tripType: "oneway" | "roundtrip" | "outstation";
  fromLabel: string | null;
  toLabel: string | null;
  pickupNote: string;
  returnDate: string | null;
  days: number;
  /** A plain Google Maps link to the traveller's shared pin, or null if they
   *  didn't share one (081) — no Maps API, just a deep link. */
  pinMapsUrl: string | null;
};

type TripDetailRow = {
  trip_type: "oneway" | "roundtrip" | "outstation";
  from_place_id: string | null;
  to_place_id: string | null;
  return_date: string | null;
  days: number;
  pickup_note: string;
  pickup_lat: number | null;
  pickup_lng: number | null;
};

export async function getCabDispatchDetail(itemId: string): Promise<CabDispatchDetail | null> {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("cab_trip_details")
    .select("trip_type, from_place_id, to_place_id, return_date, days, pickup_note, pickup_lat, pickup_lng")
    .eq("item_id", itemId)
    .maybeSingle();
  if (!data) return null;

  const row = data as unknown as TripDetailRow;

  // cab_places is a small (~40 row) admin-maintained list — resolved here by
  // id rather than an embedded PostgREST join, the same way lib/cabs.ts and
  // app/place-picker.tsx treat it as a flat list rather than joining twice
  // against the same table.
  const { getCabPlaces } = await import("./cabs");
  const places = await getCabPlaces();
  const label = (id: string | null) => places.find((p) => p.id === id)?.label ?? null;

  return {
    tripType: row.trip_type,
    fromLabel: label(row.from_place_id),
    toLabel: label(row.to_place_id),
    pickupNote: row.pickup_note,
    returnDate: row.return_date,
    days: row.days,
    pinMapsUrl:
      row.pickup_lat != null && row.pickup_lng != null
        ? `https://www.google.com/maps/dir/?api=1&destination=${row.pickup_lat},${row.pickup_lng}`
        : null,
  };
}

/** A car an admin can hand a rate-card booking to — one of the marketplace's
 *  own listed cars (048), on the booking's island. */
export type DispatchableCab = {
  cabId: string;
  model: string;
  category: "hatchback" | "sedan" | "suv" | "tempo";
  operatorName: string;
  operatorPhone: string | null;
};

type DispatchableCabRow = {
  id: string;
  model: string;
  category: "hatchback" | "sedan" | "suv" | "tempo";
  partners: { name: string; contact_phone: string | null } | null;
};

export async function getDispatchableCabs(islandSlug: string): Promise<DispatchableCab[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("cabs")
    .select("id, model, category, partners!inner ( name, contact_phone, status, island_slug )")
    .eq("is_listed", true)
    .eq("partners.status", "approved")
    .eq("partners.island_slug", islandSlug)
    .order("model");
  if (error || !data) return [];

  return (data as unknown as DispatchableCabRow[]).map((row) => ({
    cabId: row.id,
    model: row.model,
    category: row.category,
    operatorName: row.partners?.name ?? "Operator",
    operatorPhone: row.partners?.contact_phone ?? null,
  }));
}

export async function assignCabOperator(itemId: string, cabId: string): Promise<AdminActionResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("admin_assign_cab_operator", {
    p_item_id: itemId,
    p_cab_id: cabId,
  });
  if (error) return { ok: false, message: "Something went wrong. Try again." };
  const row = Array.isArray(data) && data.length > 0 ? (data[0] as { ok: boolean; message: string }) : null;
  if (!row?.ok) return { ok: false, message: row?.message ?? "Something went wrong. Try again." };
  return { ok: true, message: row.message };
}

/** How many paid rate-card cab bookings still need a car assigned. */
export async function countCabsToAssign(): Promise<number> {
  const supabase = await supabaseServer();
  const { count } = await supabase
    .from("admin_bookings")
    .select("item_id", { count: "exact", head: true })
    .eq("kind", "cab")
    .is("cab_id", null)
    .neq("state", "refunded");
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// The message thread between traveller and partner on one booking item —
// read-only, for support context. admin_booking_thread (033) is is_admin()-
// gated; an admin can read it but can't post into it.
// ---------------------------------------------------------------------------

export type AdminThreadMessage = {
  fromPartner: boolean;
  body: string;
  stampLabel: string;
};

export async function getAdminBookingThread(itemId: string): Promise<AdminThreadMessage[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("admin_booking_thread", { p_item_id: itemId });
  if (error || !data) return [];

  return (data as { sender: string; body: string; created_at: string }[]).map((m) => ({
    fromPartner: m.sender === "partner",
    body: m.body,
    stampLabel: new Date(m.created_at).toLocaleString("en-IN", {
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "Asia/Kolkata",
    }),
  }));
}
