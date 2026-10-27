// Pure grouping for the Calendar tab — no Supabase read of its own. It just
// regroups what getPartnerBookings() already returns, by real IST calendar
// day instead of the Today/Tomorrow labels the other tabs show.

import { istDayKey } from "./partner-format";
import type { PartnerBooking } from "./partner-bookings";

/** Every booking, keyed by the IST calendar day (YYYY-MM-DD) it starts on. */
export function groupBookingsByDay(bookings: PartnerBooking[]): Map<string, PartnerBooking[]> {
  const map = new Map<string, PartnerBooking[]>();
  for (const b of bookings) {
    const key = istDayKey(b.startsAtIso);
    const list = map.get(key);
    if (list) list.push(b);
    else map.set(key, [b]);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.startsAtIso.localeCompare(b.startsAtIso));
  }
  return map;
}
