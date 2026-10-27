// The Dashboard tab's numbers — read from the same partner_bookings /
// partner_delivered views the Bookings and Earnings tabs use, just narrowed
// to what a Dashboard actually shows (today, this month) via
// getPartnerBookingsToday() / getPartnerDeliveredForDashboard() instead of
// their unbounded getPartnerBookings() / getPartnerDelivered() — those pull
// a partner's entire history, which the Bookings/Earnings tabs' own full
// lists need but a same-day glance doesn't. Nothing here is a new table, a
// new view, or a new RPC — the existing, honest data, just added up
// differently and fetched at the size this screen actually needs.
//
// Deliberately no money-in-the-bank framing anywhere below — see
// partner_delivered's own comment ("the honest list, not a payout system").
// "Completed this month" is a count and a rupee total of what travellers were
// actually checked in for, nothing more.

import { getPartnerBookingsToday, type PartnerBooking } from "./partner-bookings";
import { getPartnerDeliveredForDashboard, type DeliveredBooking } from "./partner-delivered";

export type DashboardStats = {
  /** Today's confirmed bookings that haven't been checked in yet — the one
   *  number worth a badge now that nothing needs confirming (034). */
  arrivalsToCheckIn: number;
  /** Upcoming bookings (any state) due today. */
  todayCount: number;
  /** Delivered items checked in today. */
  checkedInToday: number;
  /** Delivered items this calendar month, and what they added up to. */
  completedThisMonth: number;
  completedThisMonthPaise: number;
};

export type PartnerDashboard = {
  stats: DashboardStats;
  /** Up to 5 of today's bookings still to be checked in, soonest first. */
  toCheckIn: PartnerBooking[];
  /** Up to 5 bookings due today, for a quick "what's on" glance. */
  today: PartnerBooking[];
  /** Up to 5 most recent check-ins. */
  recentlyDelivered: DeliveredBooking[];
};

export async function getPartnerDashboard(): Promise<PartnerDashboard> {
  // Both scoped to what the Dashboard actually shows (today's bookings, this
  // month's deliveries) rather than a partner's entire history — see the
  // comments on getPartnerBookingsToday() / getPartnerDeliveredForDashboard()
  // for why that distinction matters.
  const [today, { recentlyDelivered, thisMonth }] = await Promise.all([
    getPartnerBookingsToday(),
    getPartnerDeliveredForDashboard(),
  ]);

  const toCheckIn = today.filter((b) => b.state === "confirmed" && b.redeemedAt === null);
  const checkedInToday = thisMonth.filter((d) => d.redeemedDateLabel === "Today");

  const stats: DashboardStats = {
    arrivalsToCheckIn: toCheckIn.length,
    todayCount: today.length,
    checkedInToday: checkedInToday.length,
    completedThisMonth: thisMonth.length,
    completedThisMonthPaise: thisMonth.reduce((sum, d) => sum + d.pricePaise, 0),
  };

  return {
    stats,
    toCheckIn: toCheckIn.slice(0, 5),
    today: today.slice(0, 5),
    recentlyDelivered,
  };
}

/** "Good morning" / "Good afternoon" / "Good evening" — IST, not the server's clock. */
export function istGreeting(): string {
  const hour = Number(
    new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false }),
  );
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}
