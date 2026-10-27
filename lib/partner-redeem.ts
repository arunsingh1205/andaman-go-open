"use server";

// Checking a traveller in — the bridge to look_up_booking() and
// redeem_booking() (005-redemption.sql), already built and tested when
// redemption itself was designed. Deliberately two steps, not one: the
// partner looks a code up, sees whose booking it is, and only then confirms
// the check-in. Redeeming straight off a typed code is how you check in the
// wrong person's ferry seat.

import { supabaseServer } from "./supabase-server";
import type { BookingKind } from "./bookings";

export type LookedUpBooking = {
  itemId: string;
  refCode: string;
  kind: BookingKind;
  title: string;
  party: number;
  startsAt: string;
  pricePaise: number;
  state: string;
  redeemedAt: string | null;
  /** "full", "deposit" (034), or "partial" for a cab's/stay's commission-
   *  online booking (073/097) — mirrors lib/bookings.ts's PayMode. */
  payMode: string;
  /** What's still owed in person, right now — 0 once paid in full (149). */
  balancePaise: number;
};

export type LookupResult =
  | { found: true; booking: LookedUpBooking }
  | { found: false; message: string };

type LookupRow = {
  found: boolean;
  item_id: string;
  ref_code: string;
  kind: string;
  title: string | null;
  party: number;
  starts_at: string;
  price_paise: number;
  state: string;
  redeemed_at: string | null;
  pay_mode: string;
  paid_online_paise: number;
  balance_paise: number;
} | null | undefined;

export async function lookUpBooking(code: string): Promise<LookupResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("look_up_booking", { p_code: code });

  if (error) {
    if (error.message.includes("not linked to a partner")) {
      return { found: false, message: "This account isn't linked to a business." };
    }
    return { found: false, message: "Couldn't look that up. Try again." };
  }

  const row = (Array.isArray(data) ? data[0] : null) as LookupRow;
  if (!row || !row.found) {
    return { found: false, message: "No booking here for that code. Check it and try again." };
  }

  return {
    found: true,
    booking: {
      itemId: row.item_id,
      refCode: row.ref_code,
      kind: row.kind as BookingKind,
      title: row.title ?? "Booking",
      party: row.party,
      startsAt: row.starts_at,
      pricePaise: row.price_paise,
      state: row.state,
      redeemedAt: row.redeemed_at,
      payMode: row.pay_mode,
      balancePaise: row.balance_paise,
    },
  };
}

export type RedeemResult = {
  ok: boolean;
  already: boolean;
  message: string;
};

type RedeemRow = {
  ok: boolean;
  already: boolean;
  message: string;
} | null | undefined;

export async function redeemBooking(code: string): Promise<RedeemResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("redeem_booking", { p_code: code });

  if (error) {
    return { ok: false, already: false, message: "Couldn't check that in. Try again." };
  }

  const row = (Array.isArray(data) ? data[0] : null) as RedeemRow;
  return {
    ok: Boolean(row?.ok),
    already: Boolean(row?.already),
    message: row?.message ?? "Something went wrong.",
  };
}

export type UndoRedeemResult = { ok: boolean; message: string };

/** Walks back a mistaken tap on "Check in" — same day only (051). Reopens
 *  the slot and puts the booking back to "confirmed", as if it never
 *  happened. */
export async function undoRedeemBookingItem(itemId: string): Promise<UndoRedeemResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("undo_redeem_booking_item", { p_item_id: itemId });

  if (error) {
    return { ok: false, message: "Couldn't undo that. Try again." };
  }

  const row = Array.isArray(data) ? (data[0] as UndoRedeemResult) : null;
  return { ok: Boolean(row?.ok), message: row?.message ?? "Something went wrong." };
}
