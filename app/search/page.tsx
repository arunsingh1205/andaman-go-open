import { getActivities, rupees } from "@/lib/activities";
import { getStays } from "@/lib/stays";
import { getTrips } from "@/lib/trips";
import SearchView, { type SearchItem } from "./search-view";

// getActivities() reads Supabase with no-store, which this route inherits —
// make that explicit rather than let a build quietly fail on it.
export const dynamic = "force-dynamic";

function norm(...parts: (string | number)[]) {
  return parts.join(" ").toLowerCase();
}

/** Two-letter mark for items (trips) that don't come with one of their own. */
function initials(title: string) {
  const [a, b] = title.split(" ").filter(Boolean);
  return ((a?.[0] ?? "") + (b?.[0] ?? "")).toUpperCase();
}

async function getSearchItems(): Promise<SearchItem[]> {
  const [activities, stays, trips] = await Promise.all([getActivities(), getStays(), getTrips()]);

  return [
    ...activities.map((a) => ({
      id: a.slug,
      kind: "activity" as const,
      mark: a.mark,
      title: a.name,
      sub: a.operator,
      rating: a.rating,
      reviews: a.reviews,
      priceLabel: `${rupees(a.pricePaise)} / person`,
      href: `/activities/${a.slug}`,
      haystack: norm(a.name, a.operator, a.category, a.summary),
    })),
    ...stays.map((s) => ({
      id: s.slug,
      kind: "stay" as const,
      mark: s.mark,
      title: s.name,
      sub: `${s.area} · ${s.propertyType}`,
      rating: s.rating,
      reviews: s.reviews,
      priceLabel:
        s.roomTypes.length > 0
          ? `${rupees(Math.min(...s.roomTypes.map((r) => r.nightlyRatePaise)))} / night`
          : "—",
      href: `/stays/${s.slug}`,
      haystack: norm(s.name, s.area, s.propertyType, s.tagline, s.about),
    })),
    ...trips.map((t) => ({
      id: t.slug,
      kind: "trip" as const,
      mark: initials(t.title),
      title: t.title,
      sub: `Hosted by ${t.host}`,
      rating: t.rating,
      reviews: t.reviews,
      priceLabel: `${rupees(t.pricePaise)} / person`,
      href: `/trips/${t.slug}`,
      haystack: norm(t.title, t.host, t.island, t.summary),
    })),
  ];
}

export default async function SearchPage() {
  const items = await getSearchItems();
  return <SearchView items={items} />;
}
