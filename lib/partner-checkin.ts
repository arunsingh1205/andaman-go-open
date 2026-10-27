"use server";

// The door: today's confirmed arrivals, and the three things a person
// working it needs beyond scanning a code — check someone in, mark a
// no-show, or drop the party count before checking them in (029).

import { getPartnerBookings, type PartnerBooking } from "./partner-bookings";
import { supabaseServer } from "./supabase-server";

export type CheckInResult = { ok: boolean; message: string };

function firstRow(data: unknown): { ok: boolean; message: string } | null {
  return Array.isArray(data) ? (data[0] as { ok: boolean; message: string }) : null;
}

export type TodayArrivals = {
  /** Confirmed, not yet checked in, not a no-show — soonest first. */
  toCheckIn: PartnerBooking[];
  /** Checked in today. */
  done: PartnerBooking[];
  /** Marked as no-shows. */
  noShows: PartnerBooking[];
};

export async function getTodayArrivals(): Promise<TodayArrivals> {
  const bookings = await getPartnerBookings();
  const today = bookings.filter((b) => b.dateLabel === "Today");

  return {
    toCheckIn: today
      .filter((b) => b.state === "confirmed" && b.redeemedAt === null)
      .sort((a, b) => a.startsAtIso.localeCompare(b.startsAtIso)),
    done: today
      .filter((b) => b.redeemedAt !== null)
      .sort((a, b) => (b.redeemedAt ?? "").localeCompare(a.redeemedAt ?? "")),
    noShows: today.filter((b) => b.state === "missed"),
  };
}

async function callRpc(name: string, args: Record<string, unknown>): Promise<CheckInResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc(name, args);
  if (error) return { ok: false, message: "Couldn't do that. Try again." };
  const row = firstRow(data);
  return { ok: Boolean(row?.ok), message: row?.message ?? "Couldn't do that." };
}

export async function markNoShow(itemId: string): Promise<CheckInResult> {
  return callRpc("mark_no_show", { p_item_id: itemId });
}

export async function clearNoShow(itemId: string): Promise<CheckInResult> {
  return callRpc("clear_no_show", { p_item_id: itemId });
}

export async function adjustParty(itemId: string, party: number): Promise<CheckInResult> {
  return callRpc("adjust_booking_party", { p_item_id: itemId, p_party: party });
}
