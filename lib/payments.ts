// Payments — the deposit split, and which categories accept one.
//
// A "deposit" is that specific listing's own operator's commission
// (commission_bps, migration 138) — matched by
// `round(v_price * commission_bps / 10000)` in create_booking(). Nothing
// here *charges* anything — there is no gateway yet — it only tells the
// booking screens what to offer and works out the split for display, off
// the same price and rate the database uses.

import { DEPOSIT_RATE, type PayMode } from "./pricing";
import { supabase, unwrap } from "./supabase";
import type { BookingKind } from "./bookings";

export { DEPOSIT_RATE };
export type { PayMode };

/**
 * How a category is paid for, set per kind in the admin console (034):
 *   'free'    — nothing is charged
 *   'full'    — always the whole price, online
 *   'choice'  — the traveller picks a deposit (that listing's own operator's
 *               commission, 138) now, or the whole price now.
 *   'contact' — legacy label for the cab category, no longer read.
 *
 * Cabs (lib/cabs.ts `cabPaymentSplit`, migration 073) and stays
 * (lib/stays.ts `stayPaymentSplit`, migration 097) run the same shape
 * through their own bespoke split rather than this generic one — the
 * commission online now (or the whole price), the rest paid in person — to
 * the driver, or to the property.
 */
export type PaymentMode = "free" | "full" | "choice" | "contact";

/** What comes out now if a deposit is chosen — that listing's own operator's
 *  commission, rounded the same way as the DB. `bps` is that listing's own
 *  commissionBps (Activity/Trip/Shop, mirroring CabOperator/Stay); falls
 *  back to DEPOSIT_RATE's rate only if it somehow reads back null. */
export function depositPaise(pricePaise: number, bps: number | null): number {
  const rate = bps ?? Math.round(DEPOSIT_RATE * 10000);
  return Math.round((pricePaise * rate) / 10000);
}

/**
 * The two figures a price box and a confirmation screen show: what is paid
 * online now, and what is still owed in person. `full` settles everything
 * now; `deposit` pays exactly `bps` of the price (that listing's own
 * operator's commission) and leaves the rest for in person.
 */
export function paymentSplit(
  pricePaise: number,
  mode: PayMode,
  bps: number | null,
): { paidNowPaise: number; balancePaise: number } {
  if (mode === "deposit") {
    const paidNowPaise = depositPaise(pricePaise, bps);
    return { paidNowPaise, balancePaise: pricePaise - paidNowPaise };
  }
  return { paidNowPaise: pricePaise, balancePaise: 0 };
}

type ModeRow = { kind: BookingKind; mode: PaymentMode };

/** Every category's payment mode, keyed by kind. One read — the table is
 *  seven tiny rows, so a screen that needs one still just fetches the lot. */
export async function getPaymentModes(): Promise<Record<BookingKind, PaymentMode>> {
  const rows = (await supabase
    .from("category_payment")
    .select("kind, mode")
    .then((r) => unwrap(r, "payment modes"))) as unknown as ModeRow[];

  const out = {} as Record<BookingKind, PaymentMode>;
  for (const row of rows) out[row.kind] = row.mode;
  return out;
}

export async function paymentModeFor(kind: BookingKind): Promise<PaymentMode> {
  const modes = await getPaymentModes();
  return modes[kind] ?? "full";
}
