// Listing photos — the public URL for one, and how many a listing may hold.
//
// Partner photos live in the public `partner-photos` bucket. Building the URL
// is a pure string join off the project URL, so unlike partnerPhotoUrl() in
// lib/partner-storage.ts (which is "use client" and goes through the browser
// client) this one is safe to call on the server — which is where the
// traveller catalogue readers run.

import { SUPABASE_URL } from "./supabase-env";

/** How many photos one listing may carry. */
export const LISTING_PHOTO_MAX = 8;

/** The kinds listing_photos.listing_kind accepts — same vocabulary as
 *  booking_items.kind and lib/admin-review.ts's ListingKind. */
export type ListingPhotoKind =
  | "activity"
  | "rental"
  | "cab"
  | "event"
  | "trip"
  | "ferry"
  | "stay"
  | "community";

/** The traveller-facing URL for something in the public partner-photos bucket. */
export function listingPhotoUrl(path: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/partner-photos/${path}`;
}
