// Earnings & Payouts — real totals, split three ways: gross (what the
// traveller was charged), commission (Andaman Go's cut at the category
// rate, 025), and net (what the partner is owed). Still not a payment
// tracker — there's no "paid" status anywhere, because nothing has actually
// paid out yet.
//
// Two sources feed every number here: bookings actually checked in
// (partner-delivered.ts), and bookings that were cancelled but still
// retained some money — a forfeited deposit, or the half kept on a
// full-payment cancellation (partner-cancellations.ts, 050). A partner's own
// cancellation refunds the traveller in full, so it contributes nothing.

import { getPartnerDelivered, type DeliveredBooking } from "./partner-delivered";
import { getPartnerCancellations, type CancelledBooking } from "./partner-cancellations";
import { istDayKey, istMonthKey } from "./partner-format";
import { addDays, dayKey, todayIST } from "./date";

export type EarningsWindow = {
  count: number;
  grossPaise: number;
  commissionPaise: number;
  netPaise: number;
  /** Of `netPaise`, what the partner already took in cash at the counter. */
  cashCollectedPaise: number;
  /** Of `netPaise`, what Andaman Go still owes once payouts run. */
  platformOwesPaise: number;
  /** How many of `count` were cancellations that retained money, not deliveries. */
  cancelledCount: number;
  /** Of `netPaise`, how much came from retained cancellation money. */
  cancelledNetPaise: number;
};

export type EarningsStats = {
  today: EarningsWindow;
  thisWeek: EarningsWindow;
  thisMonth: EarningsWindow;
  allTime: EarningsWindow;
};

export type MonthlyStatement = {
  monthKey: string;
  label: string;
} & EarningsWindow;

export type PartnerEarnings = {
  stats: EarningsStats;
  statements: MonthlyStatement[];
  delivered: DeliveredBooking[];
  cancelled: CancelledBooking[];
};

function totalOf(delivered: DeliveredBooking[], cancelled: CancelledBooking[]): EarningsWindow {
  const cancelledNetPaise = cancelled.reduce((s, c) => s + c.netPaise, 0);
  return {
    count: delivered.length + cancelled.length,
    grossPaise:
      delivered.reduce((s, d) => s + d.pricePaise, 0) +
      cancelled.reduce((s, c) => s + c.retainedPaise, 0),
    commissionPaise:
      delivered.reduce((s, d) => s + d.commissionPaise, 0) +
      cancelled.reduce((s, c) => s + c.commissionPaise, 0),
    netPaise: delivered.reduce((s, d) => s + d.netPaise, 0) + cancelledNetPaise,
    cashCollectedPaise: delivered.reduce((s, d) => s + d.cashCollectedPaise, 0),
    platformOwesPaise: delivered.reduce((s, d) => s + d.platformOwesPaise, 0) + cancelledNetPaise,
    cancelledCount: cancelled.length,
    cancelledNetPaise,
  };
}

function monthLabel(monthKey: string): string {
  return new Date(`${monthKey}-01T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export async function getPartnerEarnings(): Promise<PartnerEarnings> {
  const [delivered, cancelled] = await Promise.all([
    getPartnerDelivered(),
    getPartnerCancellations(),
  ]);

  const today = todayIST();
  const todayKey = dayKey(today);
  const monthKey = istMonthKey(today.toISOString());

  const last7 = new Set<string>();
  for (let i = 0; i < 7; i++) last7.add(dayKey(addDays(today, -i)));

  const deliveredToday = delivered.filter((d) => istDayKey(d.redeemedAtIso) === todayKey);
  const deliveredWeek = delivered.filter((d) => last7.has(istDayKey(d.redeemedAtIso)));
  const deliveredMonth = delivered.filter((d) => istMonthKey(d.redeemedAtIso) === monthKey);

  const cancelledToday = cancelled.filter((c) => istDayKey(c.cancelledAtIso) === todayKey);
  const cancelledWeek = cancelled.filter((c) => last7.has(istDayKey(c.cancelledAtIso)));
  const cancelledMonth = cancelled.filter((c) => istMonthKey(c.cancelledAtIso) === monthKey);

  // Every month that has at least one checked-in or money-retaining
  // cancelled booking, newest first.
  const deliveredByMonth = new Map<string, DeliveredBooking[]>();
  for (const d of delivered) {
    const key = istMonthKey(d.redeemedAtIso);
    const list = deliveredByMonth.get(key);
    if (list) list.push(d);
    else deliveredByMonth.set(key, [d]);
  }
  const cancelledByMonth = new Map<string, CancelledBooking[]>();
  for (const c of cancelled) {
    const key = istMonthKey(c.cancelledAtIso);
    const list = cancelledByMonth.get(key);
    if (list) list.push(c);
    else cancelledByMonth.set(key, [c]);
  }
  const allMonthKeys = new Set([...deliveredByMonth.keys(), ...cancelledByMonth.keys()]);
  const statements: MonthlyStatement[] = [...allMonthKeys]
    .sort((a, b) => b.localeCompare(a))
    .map((key) => ({
      monthKey: key,
      label: monthLabel(key),
      ...totalOf(deliveredByMonth.get(key) ?? [], cancelledByMonth.get(key) ?? []),
    }));

  return {
    stats: {
      today: totalOf(deliveredToday, cancelledToday),
      thisWeek: totalOf(deliveredWeek, cancelledWeek),
      thisMonth: totalOf(deliveredMonth, cancelledMonth),
      allTime: totalOf(delivered, cancelled),
    },
    statements,
    delivered,
    cancelled,
  };
}
