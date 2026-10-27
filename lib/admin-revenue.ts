"use server";

// What each business actually delivered, month by month — plus what it kept
// from cancellations that never delivered anything.
//
// "Revenue" is a word worth being careful with here. There is no payment
// system in this app yet — no deposits, no settlement, no payouts. This
// screen counts two things, both real money moves rather than guesses:
//
//   * bookings that were checked in, at the price they were booked at
//     (bucketed by redeemed_at — the same definition the partner-facing
//     Earnings tab uses, so a partner and an admin see the same number).
//   * bookings that were cancelled but still retained some money — a
//     forfeited deposit, or the half kept on a full-payment cancellation
//     (bucketed by cancelled_at, 050). Nothing was delivered, so the whole
//     retained amount is Andaman Go's — same "no payout on a cancellation"
//     rule run_settlement_impl enforces (137c), not a bps-based split. A
//     partner's own cancellation refunds the traveller in full, so it never
//     appears here.
//
// It also splits net between what the partner already took in cash at the
// counter (the balance on deposit bookings — cancellations never reach the
// counter, so that's always ₹0 for them) and what Andaman Go still owes.
// Still no "paid" status — nothing has actually settled.

import { instantIso } from "./date";
import { supabaseServer } from "./supabase-server";
import { istMonthKey } from "./partner-format";

export type PartnerRevenue = {
  partnerId: string;
  partnerName: string;
  partnerStatus: "pending" | "approved" | "suspended" | "rejected";
  islandSlug: string;
  delivered: number;
  /** Cancellations this month that still retained money. */
  cancelled: number;
  grossPaise: number;
  /** Andaman Go's cut — each business's own agreed rate (137) on a
   *  delivered booking; the whole retained amount on a cancellation. */
  commissionPaise: number;
  netPaise: number;
  /** Of net, what the partner already took in cash at their counter. */
  cashCollectedPaise: number;
  /** Of net, what Andaman Go still owes the partner. */
  platformOwesPaise: number;
  /** Share of the month's platform-wide gross, 0–100. */
  sharePct: number;
};

export type RevenueMonth = {
  monthKey: string;
  label: string;
  rows: PartnerRevenue[];
  totalDelivered: number;
  totalCancelled: number;
  totalGrossPaise: number;
  totalCommissionPaise: number;
  totalNetPaise: number;
  totalCashCollectedPaise: number;
  totalPlatformOwesPaise: number;
};

type DeliveredRow = {
  partner_id: string;
  partner_name: string;
  partner_status: "pending" | "approved" | "suspended" | "rejected";
  island_slug: string;
  price_paise: number;
  commission_bps: number | null;
  redeemed_at: string | null;
  pay_mode: "full" | "deposit" | "partial" | null;
  balance_paise: number | null;
  /** Rental hotel-delivery add-on folded into price_paise — never
   *  commissionable (064). */
  delivery_paise: number | null;
  /** A promo code's discount (158/161) — already subtracted out of
   *  price_paise, so commission is computed on price_paise + this, not on
   *  price_paise alone. See the commission line below. */
  discount_paise: number | null;
};

type CancelledRow = {
  partner_id: string;
  partner_name: string;
  partner_status: "pending" | "approved" | "suspended" | "rejected";
  island_slug: string;
  price_paise: number;
  commission_bps: number | null;
  cancelled_at: string | null;
  paid_online_paise: number | null;
  refunded_paise: number | null;
  delivery_paise: number | null;
};

function blankRow(
  partnerId: string,
  partnerName: string,
  partnerStatus: PartnerRevenue["partnerStatus"],
  islandSlug: string,
): PartnerRevenue {
  return {
    partnerId,
    partnerName,
    partnerStatus,
    islandSlug,
    delivered: 0,
    cancelled: 0,
    grossPaise: 0,
    commissionPaise: 0,
    netPaise: 0,
    cashCollectedPaise: 0,
    platformOwesPaise: 0,
    sharePct: 0,
  };
}

/** "2026-08" -> "August 2026". */
export async function monthLabel(monthKey: string): Promise<string> {
  return new Date(`${monthKey}-01T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** The last `count` months, newest first, as YYYY-MM — for the month picker. */
export async function recentMonthKeys(count = 6): Promise<string[]> {
  const out: string[] = [];
  const now = new Date();
  for (let i = 0; i < count; i += 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

export async function getRevenueForMonth(monthKey: string): Promise<RevenueMonth> {
  const supabase = await supabaseServer();

  const [year, month] = monthKey.split("-").map(Number);
  const start = instantIso(`${monthKey}-01`, 0);
  const nextMonth = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  const end = instantIso(nextMonth, 0);

  // Delivered bookings, bucketed by redeemed_at — a booking belongs to the
  // month it was actually delivered in, same reasoning as before.
  const deliveredQuery = supabase
    .from("admin_bookings")
    .select(
      "partner_id, partner_name, partner_status, island_slug, price_paise, commission_bps, redeemed_at, pay_mode, balance_paise, delivery_paise, discount_paise",
    )
    .not("redeemed_at", "is", null)
    .gte("redeemed_at", start)
    .lt("redeemed_at", end);

  // Cancellations that retained money, bucketed by cancelled_at instead —
  // there is no redeemed_at on these, so redeemed-month accounting doesn't
  // apply.
  const cancelledQuery = supabase
    .from("admin_bookings")
    .select(
      "partner_id, partner_name, partner_status, island_slug, price_paise, commission_bps, cancelled_at, paid_online_paise, refunded_paise, delivery_paise",
    )
    .eq("state", "refunded")
    .not("cancelled_at", "is", null)
    .gte("cancelled_at", start)
    .lt("cancelled_at", end);

  const [deliveredResult, cancelledResult] = await Promise.all([deliveredQuery, cancelledQuery]);

  if (deliveredResult.error) {
    throw new Error(`Supabase: could not load revenue — ${deliveredResult.error.message}`);
  }
  if (cancelledResult.error) {
    throw new Error(`Supabase: could not load revenue — ${cancelledResult.error.message}`);
  }

  const deliveredRows = (deliveredResult.data ?? []) as unknown as DeliveredRow[];
  const cancelledRows = (cancelledResult.data ?? []) as unknown as CancelledRow[];
  const byPartner = new Map<string, PartnerRevenue>();

  let totalDelivered = 0;
  let totalCancelled = 0;
  let totalGrossPaise = 0;
  let totalCommissionPaise = 0;
  let totalNetPaise = 0;
  let totalCashCollectedPaise = 0;
  let totalPlatformOwesPaise = 0;

  for (const row of deliveredRows) {
    // Belt and braces: the range filter above is on a timestamp, and month
    // boundaries are IST, so re-check the IST month the row actually lands in.
    if (!row.redeemed_at || istMonthKey(row.redeemed_at) !== monthKey) continue;

    // A promo code's discount (158/161) comes out of Andaman Go's own
    // commission, not the operator's share — so commission is computed on
    // what the price would have been before that discount
    // (price_paise + discount_paise is always safe to reconstruct;
    // compute_promo_discount never lets the discount exceed the order
    // amount), then the discount is subtracted back out, floored at zero.
    const discount = row.discount_paise ?? 0;
    const commissionable = row.price_paise + discount - (row.delivery_paise ?? 0);
    const commissionBeforeDiscount = Math.round((commissionable * (row.commission_bps ?? 0)) / 10000);
    const commission = Math.max(0, commissionBeforeDiscount - discount);
    const net = row.price_paise - commission;
    // The counter cash: the balance on a deposit booking, or the un-prepaid
    // part of a cab fare the driver takes directly (both carry a balance_paise).
    const cash = row.pay_mode && row.pay_mode !== "full" ? (row.balance_paise ?? 0) : 0;
    const owed = Math.max(0, net - cash);

    const partner =
      byPartner.get(row.partner_id) ??
      blankRow(row.partner_id, row.partner_name, row.partner_status, row.island_slug);
    partner.delivered += 1;
    partner.grossPaise += row.price_paise;
    partner.commissionPaise += commission;
    partner.netPaise += net;
    partner.cashCollectedPaise += cash;
    partner.platformOwesPaise += owed;
    byPartner.set(row.partner_id, partner);

    totalDelivered += 1;
    totalGrossPaise += row.price_paise;
    totalCommissionPaise += commission;
    totalNetPaise += net;
    totalCashCollectedPaise += cash;
    totalPlatformOwesPaise += owed;
  }

  for (const row of cancelledRows) {
    if (!row.cancelled_at || istMonthKey(row.cancelled_at) !== monthKey) continue;

    const retained = (row.paid_online_paise ?? 0) - (row.refunded_paise ?? 0);
    if (retained <= 0) continue;

    // Nothing was delivered, so the whole retained amount is Andaman Go's —
    // capped here rather than this partner's own bps, same rule
    // run_settlement_impl enforces (137c). Nothing was checked in either,
    // so nothing was ever collected at a counter, and nothing is owed.
    const commission = retained;
    const net = 0;
    const owed = 0;

    const partner =
      byPartner.get(row.partner_id) ??
      blankRow(row.partner_id, row.partner_name, row.partner_status, row.island_slug);
    partner.cancelled += 1;
    partner.grossPaise += retained;
    partner.commissionPaise += commission;
    partner.netPaise += net;
    partner.platformOwesPaise += owed;
    byPartner.set(row.partner_id, partner);

    totalCancelled += 1;
    totalGrossPaise += retained;
    totalCommissionPaise += commission;
    totalNetPaise += net;
    totalPlatformOwesPaise += owed;
  }

  const list = [...byPartner.values()].sort((a, b) => b.grossPaise - a.grossPaise);
  for (const partner of list) {
    partner.sharePct = totalGrossPaise === 0 ? 0 : (partner.grossPaise / totalGrossPaise) * 100;
  }

  return {
    monthKey,
    label: await monthLabel(monthKey),
    rows: list,
    totalDelivered,
    totalCancelled,
    totalGrossPaise,
    totalCommissionPaise,
    totalNetPaise,
    totalCashCollectedPaise,
    totalPlatformOwesPaise,
  };
}
