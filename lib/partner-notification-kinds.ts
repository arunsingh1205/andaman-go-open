// The notification kinds and where each one links — split out with no server
// imports so a client component (the notifications list) can use it.

export type PartnerNotificationKind =
  | "booking_new"
  | "booking_cancelled"
  | "booking_disrupted"
  | "booking_message"
  | "review"
  | "support";

/** Where tapping a notification should go. */
export function notificationHref(
  kind: PartnerNotificationKind,
  itemId: string | null,
): string | null {
  if (kind === "review") return "/partner/reviews";
  if (kind === "support") return "/partner/help";
  if (itemId) return `/partner/bookings/${itemId}`;
  return "/partner/bookings";
}
