import { getRevenueForMonth, recentMonthKeys, monthLabel } from "@/lib/admin-revenue";
import { getCategoryPayments } from "@/lib/admin-payment";
import { requireOwner } from "@/lib/admin-auth";
import RevenueView from "./revenue-view";

// What each business delivered, month by month. See lib/admin-revenue.ts for
// why "delivered" and not "booked", and why there is no payout column.
//
// Owner-only (139) — staff doesn't get this section. There's no dedicated
// RPC to gate at the database for the money-sensitive part specifically
// (this reads admin_bookings, a view Bookings and a partner's own track
// record also depend on), so this page-level guard is the actual
// enforcement, not a courtesy in front of one.

export const dynamic = "force-dynamic";

export default async function AdminRevenuePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  await requireOwner();

  const { month } = await searchParams;
  const months = await recentMonthKeys(6);
  const selected = month && /^\d{4}-\d{2}$/.test(month) ? month : months[0];

  const [data, labels, payments] = await Promise.all([
    getRevenueForMonth(selected),
    Promise.all(months.map((m) => monthLabel(m))),
    getCategoryPayments(),
  ]);

  return (
    <RevenueView
      data={data}
      months={months.map((key, i) => ({ key, label: labels[i] }))}
      payments={payments}
    />
  );
}
