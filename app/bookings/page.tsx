import { getBookingDays } from "@/lib/my-bookings";
import { qrCode, type QrCode } from "@/lib/qr";
import BottomNav from "@/app/bottom-nav";
import BookingsList from "./bookings-list";
import OfflineTickets from "./offline-tickets";

export default async function BookingsPage() {
  const days = await getBookingDays();

  // Every QR is drawn here, on the server, and sent down as a path string.
  // The phone never runs the encoder.
  const tickets: Record<string, QrCode> = {};
  for (const day of days) {
    for (const item of day.items) {
      if (item.ticket) {
        tickets[item.id] = qrCode(`https://andamango.app/t/${item.ticket}`);
      }
    }
  }

  return (
    <>
      <div className="sticky top-0 z-30 border-b border-hairline bg-surface">
        <div className="page-well pt-[calc(var(--safe-top)+1.5rem)] pb-4 lg:pt-10 lg:pb-6">
          <h1 className="font-display text-[22px] lg:text-page font-bold tracking-tight">Bookings</h1>
          <p className="mt-0.5 text-[12px] font-medium text-muted">
            One reference a day. If the weather takes one thing, it takes the lot.
          </p>
        </div>
      </div>

      <main className="page-well pt-4 pb-32 lg:pt-8 lg:pb-24">
        <BookingsList days={days} tickets={tickets} />
        {/* Keeps the next few days of tickets on the phone, for the jetty
            with no signal. Renders nothing; native app only. */}
        <OfflineTickets days={days} tickets={tickets} />
      </main>

      <BottomNav />
    </>
  );
}
