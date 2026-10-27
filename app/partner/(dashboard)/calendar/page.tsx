import { redirect } from "next/navigation";
import { getPartnerSession } from "@/lib/partner-auth";
import { getPartnerBookingsFrom } from "@/lib/partner-bookings";
import { getCloseableListings, getPartnerClosures } from "@/lib/partner-closures";
import { addDays, dayKey, todayIST } from "@/lib/date";
import CalendarView from "./calendar-view";

// How far back the calendar still shows bookings/closures for — long enough
// to check a recent date, not so long that a partner's full history (which
// only ever grows) has to be pulled on every Calendar load. Upcoming
// bookings have no upper bound here; nobody books far enough ahead for that
// side to need one.
const CALENDAR_LOOKBACK_DAYS = 90;

export default async function PartnerCalendarPage() {
  const session = await getPartnerSession();
  if (!session) redirect("/partner/login");

  const lookbackKey = dayKey(addDays(todayIST(), -CALENDAR_LOOKBACK_DAYS));
  const lookbackIso = `${lookbackKey}T00:00:00+05:30`;

  const [bookings, closeable, closures] = await Promise.all([
    getPartnerBookingsFrom(lookbackIso),
    getCloseableListings(session.partnerId),
    getPartnerClosures(session.partnerId, lookbackKey),
  ]);

  return (
    <CalendarView
      bookings={bookings}
      closeable={closeable}
      closures={closures}
      todayKey={dayKey(todayIST())}
      role={session.role}
    />
  );
}
