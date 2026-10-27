import { getPartnerBookings } from "@/lib/partner-bookings";
import PartnerBookingsList from "./partner-bookings-list";

export default async function PartnerBookingsPage() {
  const bookings = await getPartnerBookings();

  return (
    <>
      <h2 className="font-display text-[20px] font-bold tracking-tight">Bookings</h2>
      <p className="mt-0.5 text-[12px] font-medium text-muted">
        Everything travellers have booked with you, soonest first.
      </p>

      <PartnerBookingsList bookings={bookings} />
    </>
  );
}
