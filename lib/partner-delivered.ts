// What a partner has actually delivered — read from partner_delivered
// (005-redemption.sql, fixed to be properly scoped in 009-partner-bookings.sql).
//
// Its own comment says it best: "not a payout system — just the honest
// list. Money moves against redeemed items and nothing else." Nothing here
// is derived or guessed; every row is something a traveller actually showed
// up for and was checked in.
//
// The view has no item_id (it was never meant to be edited, only read), so
// the list key here is a composite of what does uniquely identify a
// checked-in item in practice — good enough for React, not a real key.

import { dayKey, fmtClock, todayIST } from "./date";
import { supabaseServer } from "./supabase-server";
import { dateLabelFor, istMinutes, partyLabel } from "./partner-format";
import type { BookingKind } from "./bookings";

export type DeliveredBooking = {
  key: string;
  refCode: string;
  kind: BookingKind;
  title: string;
  detail: string;
  pricePaise: number;
  /** Andaman Go's cut on this booking, at its category's rate (025). */
  commissionPaise: number;
  /** pricePaise − commissionPaise — the partner's total share of this booking. */
  netPaise: number;
  /** "full", "deposit" (034) or "partial" — a cab's part-payment (073). */
  payMode: "full" | "deposit" | "partial";
  /** What the partner collected in person — the balance on a deposit booking or
   *  the fare a cab driver takes directly, nothing on a paid-in-full one. */
  cashCollectedPaise: number;
  /** netPaise − cashCollectedPaise — what Andaman Go still owes the partner
   *  once payouts run. Deposit bookings land near zero here (the deposit ≈ the
   *  commission); paid-in-full bookings owe the whole net. */
  platformOwesPaise: number;
  dateLabel: string;
  timeLabel: string;
  redeemedDateLabel: string;
  redeemedTimeLabel: string;
  /** Raw instant, kept alongside the display labels above so the Dashboard
   * can group "this month" without re-parsing a formatted string. */
  redeemedAtIso: string;
};

type Row = {
  partner_id: string;
  ref_code: string;
  kind: BookingKind;
  title: string | null;
  party: number;
  price_paise: number;
  starts_at: string;
  redeemed_at: string;
  commission_bps: number | null;
  pay_mode: "full" | "deposit" | "partial" | null;
  paid_online_paise: number | null;
  balance_paise: number | null;
  /** The flat rental hotel-delivery add-on folded into price_paise, if any
   *  (064) — never commissionable, so callers subtract it before commissionOf. */
  delivery_paise: number | null;
  /** A promo code's discount (158/161) — already subtracted out of
   *  price_paise. Commission is computed as if it hadn't been, then the
   *  discount comes back out of that — Andaman Go's own cut shrinks, not
   *  this partner's. */
  discount_paise: number | null;
};

/** Commission in paise for a gross amount at a basis-point rate, rounded. */
export function commissionOf(pricePaise: number, bps: number | null): number {
  return Math.round((pricePaise * (bps ?? 0)) / 10000);
}

function mapDeliveredRow(row: Row, today: Date): DeliveredBooking {
  const discount = row.discount_paise ?? 0;
  const commissionBeforeDiscount = commissionOf(
    row.price_paise + discount - (row.delivery_paise ?? 0),
    row.commission_bps,
  );
  const commissionPaise = Math.max(0, commissionBeforeDiscount - discount);
  const netPaise = row.price_paise - commissionPaise;
  const payMode = row.pay_mode ?? "full";
  // On a deposit booking the partner took the balance in cash at the counter,
  // and a cab driver takes the un-prepaid part of the fare the same way; on a
  // paid-in-full one they took nothing in person.
  const cashCollectedPaise = payMode === "full" ? 0 : (row.balance_paise ?? 0);
  return {
    key: `${row.ref_code}-${row.kind}-${row.starts_at}`,
    refCode: row.ref_code,
    kind: row.kind,
    title: row.title ?? "Booking",
    detail: partyLabel(row.kind, row.party),
    pricePaise: row.price_paise,
    commissionPaise,
    netPaise,
    payMode,
    cashCollectedPaise,
    platformOwesPaise: Math.max(0, netPaise - cashCollectedPaise),
    dateLabel: dateLabelFor(row.starts_at, today),
    timeLabel: fmtClock(istMinutes(row.starts_at)),
    redeemedDateLabel: dateLabelFor(row.redeemed_at, today),
    redeemedTimeLabel: fmtClock(istMinutes(row.redeemed_at)),
    redeemedAtIso: row.redeemed_at,
  };
}

/** Everything this partner has checked a traveller in for, most recent first.
 *  Unbounded on purpose — Earnings' monthly statements need the whole
 *  history — so the Dashboard should reach for
 *  getPartnerDeliveredForDashboard() instead; this only gets more expensive
 *  as a partner's history grows. */
export async function getPartnerDelivered(): Promise<DeliveredBooking[]> {
  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from("partner_delivered")
    .select("*")
    .order("redeemed_at", { ascending: false });

  if (error) {
    throw new Error(`Supabase: could not load delivered bookings — ${error.message}`);
  }

  const rows = (data ?? []) as unknown as Row[];
  const today = todayIST();

  return rows.map((row) => mapDeliveredRow(row, today));
}

/** Just what the Dashboard needs from delivery history: the 5 most recent
 *  check-ins (for the "recently delivered" list, whatever month they're
 *  from) and this calendar month's items (for the "completed this month"
 *  count and total) — two small, date-bounded queries instead of pulling a
 *  partner's entire redemption history on every Dashboard load. */
export async function getPartnerDeliveredForDashboard(): Promise<{
  recentlyDelivered: DeliveredBooking[];
  thisMonth: DeliveredBooking[];
}> {
  const supabase = await supabaseServer();
  const today = todayIST();
  const startOfMonthIso = new Date(
    `${dayKey(today).slice(0, 7)}-01T00:00:00+05:30`,
  ).toISOString();

  const [recentResult, monthResult] = await Promise.all([
    supabase.from("partner_delivered").select("*").order("redeemed_at", { ascending: false }).limit(5),
    supabase.from("partner_delivered").select("*").gte("redeemed_at", startOfMonthIso),
  ]);

  if (recentResult.error) {
    throw new Error(`Supabase: could not load recent deliveries — ${recentResult.error.message}`);
  }
  if (monthResult.error) {
    throw new Error(`Supabase: could not load this month's deliveries — ${monthResult.error.message}`);
  }

  return {
    recentlyDelivered: ((recentResult.data ?? []) as unknown as Row[]).map((row) =>
      mapDeliveredRow(row, today),
    ),
    thisMonth: ((monthResult.data ?? []) as unknown as Row[]).map((row) => mapDeliveredRow(row, today)),
  };
}
