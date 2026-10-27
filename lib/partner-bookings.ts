// A partner's bookings — read from Supabase.
//
// lib/bookings.ts groups by day because the *traveller* holds one reference
// for a whole day. This does not group at all: each row here is one thing
// that landed on THIS business, the way a restaurant sees one incoming order
// per ticket. Two dives booked under the same reference show up as two rows,
// because it is two separate things this partner has to run.
//
// Reads partner_bookings (see 009-partner-bookings.sql) rather than
// my_bookings — a different view, scoped to the signed-in partner instead of
// the signed-in traveller, with its own RLS underneath it.

import { dayKey, fmtClock, todayIST } from "./date";
import { supabaseServer } from "./supabase-server";
import { dateLabelFor, istDayKey, istMinutes, partyLabel } from "./partner-format";
import type { BookingKind, BookingState } from "./bookings";

export type PartnerBooking = {
  itemId: string;
  refCode: string;
  kind: BookingKind;
  title: string;
  /** Raw instant, alongside the display labels below, so a calendar view
   * can group by real calendar day instead of re-parsing a formatted string. */
  startsAtIso: string;
  dateLabel: string;
  timeLabel: string;
  detail: string;
  /** Raw party count, for the door-side "two of three showed" adjustment. */
  party: number;
  pricePaise: number;
  state: BookingState;
  ticket: string | null;
  redeemedAt: string | null;
  /** Only ever set by a rate-card cab booking (088) — the traveller's own
   *  name, typed at checkout. Null for every other booking kind. */
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  /** Set only when an ADMIN cancelled this (018). A partner's own decline
   *  leaves it null, so "there is a note" means "this wasn't us". */
  cancelledNote: string | null;
  /** When the traveller made the booking. */
  bookedAtIso: string;
  /** When a partner accepted a pending booking. Null when it was auto-confirmed
   *  at booking, or is still pending. */
  confirmedAtIso: string | null;
  /** Unread messages from the traveller on this booking's thread. */
  unreadFromTraveller: number;
  /** The listing this booking is for — matches partner_view_counts.subject_id. */
  subjectId: string;
  when: "upcoming" | "past";
};

type Row = {
  item_id: string;
  partner_id: string;
  ref_code: string;
  kind: BookingKind;
  subject_id: string;
  title: string | null;
  starts_at: string;
  party: number;
  units: number;
  price_paise: number;
  state: BookingState;
  ticket_code: string | null;
  redeemed_at: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  cancelled_note: string | null;
  confirmed_at: string | null;
  booked_at: string;
  unread_from_traveller: number;
};

function mapBookingRow(row: Row, today: Date, todayKey: string): PartnerBooking {
  return {
    itemId: row.item_id,
    refCode: row.ref_code,
    kind: row.kind,
    title: row.title ?? "Booking",
    startsAtIso: row.starts_at,
    dateLabel: dateLabelFor(row.starts_at, today),
    timeLabel: fmtClock(istMinutes(row.starts_at)),
    detail: partyLabel(row.kind, row.party, row.units),
    party: row.party,
    pricePaise: row.price_paise,
    state: row.state,
    ticket: row.ticket_code,
    redeemedAt: row.redeemed_at,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    contactEmail: row.contact_email,
    cancelledNote: row.cancelled_note,
    bookedAtIso: row.booked_at,
    confirmedAtIso: row.confirmed_at,
    unreadFromTraveller: row.unread_from_traveller ?? 0,
    subjectId: row.subject_id,
    when: istDayKey(row.starts_at) >= todayKey ? "upcoming" : "past",
  };
}

/** Every booking headed to the signed-in partner, soonest first. Unbounded on
 *  purpose — the Bookings tab's own Upcoming/Past history needs all of it —
 *  so anything that only needs a slice (the Dashboard) should reach for
 *  getPartnerBookingsToday() instead rather than filtering this down in JS;
 *  this query only gets more expensive as a partner's history grows. */
export async function getPartnerBookings(): Promise<PartnerBooking[]> {
  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from("partner_bookings")
    .select("*")
    .order("starts_at", { ascending: true });

  if (error) {
    throw new Error(`Supabase: could not load bookings — ${error.message}`);
  }

  const rows = (data ?? []) as unknown as Row[];
  const today = todayIST();
  const todayKey = dayKey(today);

  return rows.map((row) => mapBookingRow(row, today, todayKey));
}

/** Bookings from a given instant on, with no upper bound — what the Calendar
 *  tab needs: every upcoming booking (naturally self-limiting — nobody books
 *  years ahead) plus a recent slice of the past for reference, without the
 *  ever-growing tail of a partner's full history behind it. Future bookings
 *  are never hidden by this; only how far back "recent" reaches is bounded. */
export async function getPartnerBookingsFrom(gteIso: string): Promise<PartnerBooking[]> {
  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from("partner_bookings")
    .select("*")
    .gte("starts_at", gteIso)
    .order("starts_at", { ascending: true });

  if (error) {
    throw new Error(`Supabase: could not load bookings — ${error.message}`);
  }

  const rows = (data ?? []) as unknown as Row[];
  const today = todayIST();
  const todayKey = dayKey(today);

  return rows.map((row) => mapBookingRow(row, today, todayKey));
}

/** Just today's bookings — what the Dashboard actually needs ("due today",
 *  "still to check in"), filtered server-side instead of pulling and slicing
 *  a partner's entire booking history on every Dashboard load. */
export async function getPartnerBookingsToday(): Promise<PartnerBooking[]> {
  const supabase = await supabaseServer();
  const startOfTodayIso = new Date(`${dayKey(todayIST())}T00:00:00+05:30`).toISOString();
  const endOfTodayIso = new Date(`${dayKey(todayIST())}T23:59:59+05:30`).toISOString();

  const { data, error } = await supabase
    .from("partner_bookings")
    .select("*")
    .gte("starts_at", startOfTodayIso)
    .lte("starts_at", endOfTodayIso)
    .order("starts_at", { ascending: true });

  if (error) {
    throw new Error(`Supabase: could not load today's bookings — ${error.message}`);
  }

  const rows = (data ?? []) as unknown as Row[];
  const today = todayIST();
  const todayKey = dayKey(today);

  return rows.map((row) => mapBookingRow(row, today, todayKey));
}

/** How many of today's confirmed bookings still need checking in — the number
 *  the Check-in tab wears as a badge. Nothing is ever "pending" now (034), so
 *  this is what's left worth a glance. Counted in the database rather than
 *  pulled and filtered, since the layout runs it on every partner page. */
export async function getArrivalsTodayCount(): Promise<number> {
  const supabase = await supabaseServer();
  const startOfTodayIso = new Date(`${dayKey(todayIST())}T00:00:00+05:30`).toISOString();
  const endOfTodayIso = new Date(`${dayKey(todayIST())}T23:59:59+05:30`).toISOString();

  const { count, error } = await supabase
    .from("partner_bookings")
    .select("item_id", { count: "exact", head: true })
    .eq("state", "confirmed")
    .is("redeemed_at", null)
    .gte("starts_at", startOfTodayIso)
    .lte("starts_at", endOfTodayIso);

  if (error) return 0;
  return count ?? 0;
}
