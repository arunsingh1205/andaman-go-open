import Link from "next/link";
import { getOverviewStats } from "@/lib/admin-dashboard";
import { getAdminBookings, countFerryToPlace } from "@/lib/admin-bookings";
import { listPartners } from "@/lib/admin-review";
import { islandLabel } from "@/lib/islands";
import {
  PageHeader,
  Panel,
  StatTile,
  EmptyState,
  BookingStatePill,
  PartnerStatusPill,
} from "../admin-ui";
import { rupees } from "../admin-format";

// The console's landing screen. Three questions in order of urgency: what is
// waiting on me, what is happening today, and how is the platform doing.
//
// Every number is a link to the screen that explains it — a tile that shows
// "4 waiting" and can't be clicked is a dead end, and the whole point of an
// overview is to be the shortest route to the thing that needs doing.

export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  const [stats, todays, waitingPartners, ferryToPlace] = await Promise.all([
    getOverviewStats(),
    getAdminBookings({ window: "today" }),
    listPartners("pending"),
    countFerryToPlace(),
  ]);

  const needsYou = stats.pendingPartners + stats.pendingListings + ferryToPlace;

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle={
          needsYou === 0
            ? "Nothing is waiting on a decision from you."
            : `${needsYou} ${needsYou === 1 ? "thing needs" : "things need"} a decision from you.`
        }
      />

      <section>
        <h2 className="text-[11px] font-bold tracking-wider text-muted uppercase">Waiting on you</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatTile
            label="Businesses"
            value={stats.pendingPartners}
            hint="applications to review"
            tone={stats.pendingPartners > 0 ? "attention" : "plain"}
            href="/admin/partners?status=pending"
          />
          <StatTile
            label="Listings"
            value={stats.pendingListings}
            hint="submissions to review"
            tone={stats.pendingListings > 0 ? "attention" : "plain"}
            href="/admin/listings"
          />
          <StatTile
            label="To check in"
            value={stats.toCheckInToday}
            hint="today's arrivals not yet scanned"
            href="/admin/bookings"
          />
          <StatTile
            label="Ferries to place"
            value={ferryToPlace}
            hint="paid, awaiting operator PNR"
            tone={ferryToPlace > 0 ? "attention" : "plain"}
            href="/admin/bookings?window=upcoming&state=ferry-to-place"
          />
        </div>
      </section>

      <section className="mt-7">
        <h2 className="text-[11px] font-bold tracking-wider text-muted uppercase">
          Today, and this month
        </h2>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label="Booked today"
            value={stats.bookingsToday}
            hint="across every partner"
            href="/admin/bookings"
          />
          <StatTile
            label="Checked in today"
            value={stats.checkedInToday}
            hint="travellers who turned up"
          />
          <StatTile
            label="Delivered this month"
            value={stats.deliveredThisMonth}
            hint="bookings actually run"
            href="/admin/revenue"
          />
          <StatTile
            label="Gross this month"
            value={rupees(stats.grossThisMonthPaise)}
            hint="at booked prices"
            tone="brand"
            href="/admin/revenue"
          />
        </div>
      </section>

      <section className="mt-7">
        <h2 className="text-[11px] font-bold tracking-wider text-muted uppercase">On the platform</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatTile
            label="Live businesses"
            value={stats.livePartners}
            hint="visible to travellers"
            href="/admin/partners?status=approved"
          />
          <StatTile
            label="Live listings"
            value={stats.liveListings}
            hint="bookable right now"
          />
          <StatTile
            label="Suspended"
            value={stats.suspendedPartners}
            hint="pulled off the app"
            tone={stats.suspendedPartners > 0 ? "attention" : "plain"}
            href="/admin/partners?status=suspended"
          />
        </div>
      </section>

      <div className="mt-7 grid gap-4 xl:grid-cols-2">
        <Panel
          title="Happening today"
          action={
            <Link href="/admin/bookings" className="text-[12px] font-bold text-brand">
              All bookings
            </Link>
          }
        >
          {todays.length === 0 ? (
            <EmptyState>Nothing is scheduled for today.</EmptyState>
          ) : (
            <ul>
              {todays.slice(0, 8).map((booking) => (
                <li
                  key={booking.itemId}
                  className="flex items-center gap-3 border-b border-hairline px-5 py-3 last:border-b-0"
                >
                  <span className="w-[68px] shrink-0 text-[12.5px] font-bold">
                    {booking.timeLabel}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-bold">{booking.title}</span>
                    <span className="block truncate text-[12px] font-medium text-muted">
                      {booking.partnerName} · {booking.detail}
                    </span>
                  </span>
                  <BookingStatePill state={booking.state} redeemed={booking.redeemedAt !== null} />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Businesses waiting"
          action={
            <Link href="/admin/partners?status=pending" className="text-[12px] font-bold text-brand">
              Review queue
            </Link>
          }
        >
          {waitingPartners.length === 0 ? (
            <EmptyState>No applications waiting.</EmptyState>
          ) : (
            <ul>
              {waitingPartners.slice(0, 8).map((partner) => (
                <li key={partner.id} className="border-b border-hairline last:border-b-0">
                  <Link
                    href={`/admin/partners/${partner.id}`}
                    className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-ground"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-bold">{partner.name}</span>
                      <span className="block truncate text-[12px] font-medium text-muted">
                        {partner.kindLabel} · {islandLabel(partner.islandSlug)}
                      </span>
                    </span>
                    <PartnerStatusPill status={partner.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
