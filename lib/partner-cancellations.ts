// What a partner earns from bookings that never happened — the cancellation
// side of partner-delivered.ts, from partner_cancellations (050).
//
// Only rows that actually retained money reach here (a partner's own
// cancellation refunds the traveller in full, so it never shows up). Nothing
// was delivered, so the whole retained amount is Andaman Go's — commission
// equals what was retained, and the partner's share is always ₹0 — same rule
// run_settlement_impl enforces (137c), not this partner's own commission_bps
// applied to the full price (that only ever worked back when every
// category's rate happened to equal the fixed retained fraction). See the
// policy copy on the partner Business page (business-view.tsx
// CancellationPolicy) for the reasoning.

import { fmtClock, todayIST } from "./date";
import { supabaseServer } from "./supabase-server";
import { dateLabelFor, istMinutes, partyLabel } from "./partner-format";
import type { BookingKind } from "./bookings";

export type CancelledBooking = {
  key: string;
  refCode: string;
  kind: BookingKind;
  title: string;
  detail: string;
  pricePaise: number;
  /** paid_online_paise − refunded_paise — what stayed in the system. */
  retainedPaise: number;
  /** Andaman Go's cut — the whole retained amount, since nothing was
   *  delivered (equal to retainedPaise). */
  commissionPaise: number;
  /** Always ₹0 — nothing was delivered, so none of the retained amount is
   *  the partner's. */
  netPaise: number;
  payMode: "full" | "deposit" | "partial";
  dateLabel: string;
  timeLabel: string;
  cancelledDateLabel: string;
  cancelledTimeLabel: string;
  cancelledAtIso: string;
};

type Row = {
  partner_id: string;
  ref_code: string;
  kind: BookingKind;
  title: string | null;
  party: number;
  price_paise: number;
  starts_at: string;
  cancelled_at: string;
  commission_bps: number | null;
  pay_mode: "full" | "deposit" | "partial" | null;
  paid_online_paise: number | null;
  refunded_paise: number | null;
  /** See partner-delivered.ts Row — never commissionable (064). */
  delivery_paise: number | null;
};

/** Everything this partner had cancelled where money was actually kept, most recent first. */
export async function getPartnerCancellations(): Promise<CancelledBooking[]> {
  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from("partner_cancellations")
    .select("*")
    .order("cancelled_at", { ascending: false });

  if (error) {
    throw new Error(`Supabase: could not load cancellations — ${error.message}`);
  }

  const rows = (data ?? []) as unknown as Row[];
  const today = todayIST();

  return rows.map((row) => {
    const retainedPaise = (row.paid_online_paise ?? 0) - (row.refunded_paise ?? 0);
    const commissionPaise = retainedPaise;
    const netPaise = 0;
    return {
      key: `${row.ref_code}-${row.kind}-${row.starts_at}-cancelled`,
      refCode: row.ref_code,
      kind: row.kind,
      title: row.title ?? "Booking",
      detail: partyLabel(row.kind, row.party),
      pricePaise: row.price_paise,
      retainedPaise,
      commissionPaise,
      netPaise,
      payMode: row.pay_mode ?? "full",
      dateLabel: dateLabelFor(row.starts_at, today),
      timeLabel: fmtClock(istMinutes(row.starts_at)),
      cancelledDateLabel: dateLabelFor(row.cancelled_at, today),
      cancelledTimeLabel: fmtClock(istMinutes(row.cancelled_at)),
      cancelledAtIso: row.cancelled_at,
    };
  });
}
