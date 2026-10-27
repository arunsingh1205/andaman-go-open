// Bookings — the shared vocabulary.
//
// Grouped by day, not listed flat, because that is what the app promises: one
// reference for the whole day, one refund if the weather takes it.
//
// The actual database read lives in lib/my-bookings.ts (it needs a
// session-aware server client). This file is only types, labels and pure
// derivations, so it stays safe to import from client components.

import type { PayMode } from "./pricing";

/**
 * What "Directions" needs: a place to search for and, when the operator gave
 * one, their own Maps pin. The button picks the right map app on the device,
 * so nothing here is a finished URL.
 */
export type Directions = {
  /** The operator's street address, for a context line. Null if they gave none. */
  addressLabel: string | null;
  /** Region-qualified search string — always safe to drop into a map app. */
  query: string;
  /** The operator's own Google/Apple Maps link, if it's a real one. */
  mapsUrl: string | null;
};

export type BookingKind =
  | "activity"
  | "ferry"
  | "event"
  | "cab"
  | "trip"
  | "rental"
  | "stay";

export type BookingState =
  | "pending"
  | "confirmed"
  | "disrupted"
  | "completed"
  | "missed"
  | "refunded";

export type Booking = {
  id: string;
  kind: BookingKind;
  title: string;
  operator: string;
  timeLabel: string;
  detail: string;
  pricePaise: number;
  state: BookingState;
  /** The code an operator scans. Null until somebody has accepted it. */
  ticket: string | null;
  /** Whether this ticket is stored on the phone. Nothing does that yet. */
  savedOffline: boolean;
  /** When a partner checked them in, if they have. */
  redeemedAt: string | null;
  /**
   * Where to send someone who wants to find this place. Only ever present
   * because they already booked it — my_bookings only ever holds a caller's
   * own rows, so this never reaches anyone who hasn't (see 014's own comment).
   * Null only when there's nothing at all to search — no address, no pin, and
   * no operator name.
   */
  directions: Directions | null;
  /**
   * The partner's cover photo, as a storage path (not a URL) — the screen
   * turns it into one with `partnerPhotoUrl()`, same as the partner and
   * admin apps already do, since building a public-bucket URL needs the
   * Supabase browser client and this file runs on the server. Same
   * booked-only scoping as `directions`: only ever present because
   * my_bookings only ever holds a caller's own rows. Null when the partner
   * hasn't set a cover photo.
   */
  partnerPhotoPath: string | null;
  /** Unread messages from the operator on this booking's thread. */
  unreadFromPartner: number;
  /** The traveller's own rating for this item, 1–5, or null if not reviewed. */
  myRating: number | null;
  /** "full" or "deposit" (034), or "partial" for a cab's commission-online
   *  booking (073) or a stay's commission-online booking (097) — the rest
   *  is owed to the driver, or to the property, in person. */
  payMode: PayMode | "partial";
  /** What was taken online. The deposit, the commission, or the whole price. */
  paidOnlinePaise: number;
  /** What's still owed in person — to the operator, or to the cab driver. Zero
   *  when paid in full. */
  balancePaise: number;
  /** What has already been refunded, once cancelled. */
  refundedPaise: number;
  /** Where a real Razorpay refund actually stands — null when nothing was
   *  ever charged online for this item (a cash booking, a forfeited
   *  deposit, an inside-24-hours cancel), so there's nothing for a gateway
   *  to reverse. "processing" means the money is on its way but hasn't
   *  landed; only "processed" means it actually has. */
  refundStatus: "processing" | "processed" | "failed" | null;
  /** True while the traveller can still cancel this from the app (upcoming,
   *  not yet run). The refund that comes with it is `refundIfCancelledPaise`. */
  canCancel: boolean;
  /** What would come back if the traveller cancelled right now: nothing for a
   *  deposit or a cab's part-payment, half the price for a full payment more
   *  than 24h out, nothing inside 24h. Mirrors cancel_my_booking_item (073). */
  refundIfCancelledPaise: number;
  /**
   * The operator's own number. For a rate-card cab booking (077/078) this is
   * null until admin_assign_cab_operator (082) hands it to a real operator —
   * which is also exactly when `ticket` stops being null, so
   * `kind === "cab" && !ticket` means "still finding a driver".
   */
  operatorPhone: string | null;
};

/** What the app offers when the weather cancels something. */
export type Disruption = {
  itemId: string;
  headline: string;
  detail: string;
  moveLabel: string;
  extraPaise: number;
  changes: { itemId: string; timeLabel: string }[];
};

export type BookingDay = {
  id: string;
  label: string;
  dateLabel: string;
  place: string;
  refCode: string;
  when: "upcoming" | "past";
  items: Booking[];
  disruption: Disruption | null;
};

export const KIND_LABEL: Record<BookingKind, string> = {
  activity: "Activity",
  ferry: "Ferry",
  event: "Event",
  cab: "Cab",
  trip: "Trip",
  rental: "Rental",
  stay: "Stay",
};

// ---------------------------------------------------------------------------
// Everything below is derived. None of it is ever stored.
// ---------------------------------------------------------------------------

/** What the whole day cost — and so what a weather refund is worth. */
export function dayTotal(day: BookingDay): number {
  return day.items.reduce((sum, item) => sum + item.pricePaise, 0);
}

/** True once every ticket on this day is on the phone. */
export function fullySaved(day: BookingDay): boolean {
  const withTickets = day.items.filter((item) => item.ticket !== null);
  return withTickets.length > 0 && withTickets.every((item) => item.savedOffline);
}

/** The time an item runs at once a move has been accepted. */
export function timeAfterMove(day: BookingDay, item: Booking): string {
  const change = day.disruption?.changes.find((c) => c.itemId === item.id);
  return change ? change.timeLabel : item.timeLabel;
}
