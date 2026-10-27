// The "Popular on <island>" row on the home screen.
//
// Not a new query — this ranks activities and trips app/explore/page.tsx
// already fetched for its own use (TripStrip, the rental price teaser),
// keeps the ones a partner has actually put a photo on, and ranks them by
// how well they've been reviewed. If nothing on the island has a photo yet
// the list comes back empty and the home screen drops the section.
// Deliberately has no fetching of its own — see rankFeatured()'s own
// comment for why.

import { rupees, type Activity } from "./activities";
import type { Trip } from "./trips";

export type FeaturedItem = {
  kind: "activity" | "trip";
  href: string;
  name: string;
  photo: string;
  priceLabel: string;
  rating: string;
  reviews: number;
  sub: string;
};

/** Best-reviewed first: rating, then how many reviews back it up. */
function rank<T extends { rating: string; reviews: number }>(a: T, b: T) {
  return Number(b.rating) - Number(a.rating) || b.reviews - a.reviews;
}

const PER_KIND = 3;
const TOTAL = 8;

/**
 * Pure ranking over data the caller already has — split out from
 * getFeatured() so app/explore/page.tsx can fetch activities and trips once
 * (in parallel with everything else the home screen needs) and hand them to
 * both this and app/trip-strip.tsx, instead of getFeatured() re-fetching
 * trips a second time from scratch for the same island on every load.
 */
export function rankFeatured(activities: Activity[], trips: Trip[]): FeaturedItem[] {
  const fromActivities: FeaturedItem[] = activities
    .filter((a) => a.photos.length > 0)
    .sort(rank)
    .slice(0, PER_KIND)
    .map((a) => ({
      kind: "activity",
      href: `/activities/${a.slug}`,
      name: a.name,
      photo: a.photos[0],
      priceLabel: `${rupees(a.pricePaise)} / person`,
      rating: a.rating,
      reviews: a.reviews,
      sub: a.operator.split(" · ")[0],
    }));

  const fromTrips: FeaturedItem[] = trips
    .filter((t) => t.photos.length > 0)
    .sort(rank)
    .slice(0, PER_KIND)
    .map((t) => ({
      kind: "trip",
      href: `/trips/${t.slug}`,
      name: t.title,
      photo: t.photos[0],
      priceLabel: `${rupees(t.pricePaise)} / person`,
      rating: t.rating,
      reviews: t.reviews,
      sub: `${t.host} · ${t.durationLabel}`,
    }));

  // Interleave so the row isn't three activities then three trips.
  const lanes = [fromActivities, fromTrips];
  const out: FeaturedItem[] = [];
  for (let i = 0; out.length < TOTAL && lanes.some((l) => l[i]); i++) {
    for (const lane of lanes) {
      if (lane[i] && out.length < TOTAL) out.push(lane[i]);
    }
  }
  return out;
}
