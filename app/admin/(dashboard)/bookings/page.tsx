import { getAdminBookings } from "@/lib/admin-bookings";
import { listPartners } from "@/lib/admin-review";
import BookingsView from "./bookings-view";

// The screen the whole of migration 018 exists for. Until now an admin could
// not read the bookings tables at all — not "saw an empty list", but had no
// policy granting a single row, which looks exactly the same from the app.
//
// The window (today / upcoming / past) is fetched server-side rather than
// filtered in the browser, because "everything, ever" is the one query on
// this console that genuinely grows without limit. Everything narrower —
// state, partner, island, search — happens in the browser on the window's
// rows, which keeps the filters instant.

export const dynamic = "force-dynamic";

export default async function AdminBookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; window?: string }>;
}) {
  const params = await searchParams;
  const window =
    params.window === "past" || params.window === "upcoming" || params.window === "all"
      ? params.window
      : "today";

  const [bookings, partners] = await Promise.all([
    getAdminBookings({ window }),
    listPartners("all"),
  ]);

  return (
    <BookingsView
      bookings={bookings}
      partners={partners.map((p) => ({ id: p.id, name: p.name }))}
      window={window}
      initialState={params.state ?? "all"}
    />
  );
}
