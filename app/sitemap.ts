import type { MetadataRoute } from "next";
import { getActivities } from "@/lib/activities";
import { getCommunityServices } from "@/lib/community";
import { getEvents } from "@/lib/events";
import { getShops } from "@/lib/rentals";
import { absoluteUrl } from "@/lib/seo";
import { getStays } from "@/lib/stays";
import { getTrips } from "@/lib/trips";

// The listings are read from Supabase uncached (see lib/supabase.ts), so a
// listing that goes live is in the sitemap on the next crawl.
export const dynamic = "force-dynamic";

const STATIC: { path: string; priority: number; changeFrequency: "daily" | "weekly" | "monthly" | "yearly" }[] = [
  { path: "/", priority: 1, changeFrequency: "weekly" },
  { path: "/explore", priority: 0.9, changeFrequency: "daily" },
  { path: "/activities", priority: 0.9, changeFrequency: "daily" },
  { path: "/ferry", priority: 0.9, changeFrequency: "daily" },
  { path: "/stays", priority: 0.9, changeFrequency: "daily" },
  { path: "/cabs", priority: 0.8, changeFrequency: "weekly" },
  { path: "/scooty", priority: 0.8, changeFrequency: "daily" },
  { path: "/trips", priority: 0.8, changeFrequency: "daily" },
  { path: "/events", priority: 0.7, changeFrequency: "daily" },
  { path: "/community", priority: 0.6, changeFrequency: "daily" },
  { path: "/help", priority: 0.4, changeFrequency: "monthly" },
  { path: "/contact", priority: 0.4, changeFrequency: "yearly" },
  { path: "/terms", priority: 0.2, changeFrequency: "yearly" },
  { path: "/privacy", priority: 0.2, changeFrequency: "yearly" },
  { path: "/refunds", priority: 0.2, changeFrequency: "yearly" },
  { path: "/shipping", priority: 0.2, changeFrequency: "yearly" },
];

/** One kind of listing failing to load shouldn't take the whole sitemap
 *  down with it — the rest is still worth serving. */
async function entries<T>(
  load: () => Promise<T[]>,
  toEntry: (item: T) => { path: string; image?: string },
): Promise<MetadataRoute.Sitemap> {
  const items = await load().catch((err) => {
    console.error("sitemap: listing read failed", err);
    return [] as T[];
  });

  return items.map((item) => {
    const { path, image } = toEntry(item);
    return {
      url: absoluteUrl(path),
      changeFrequency: "daily" as const,
      priority: 0.7,
      ...(image ? { images: [image] } : {}),
    };
  });
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const listings = await Promise.all([
    entries(() => getActivities(), (a) => ({ path: `/activities/${a.slug}`, image: a.photos[0] })),
    entries(() => getStays(), (s) => ({ path: `/stays/${s.slug}`, image: s.photos[0] })),
    entries(() => getTrips(), (t) => ({ path: `/trips/${t.slug}`, image: t.photos[0] })),
    entries(() => getShops(), (s) => ({
      path: `/scooty/${s.slug}`,
      image: s.vehicles.find((v) => v.photos.length > 0)?.photos[0],
    })),
    entries(() => getEvents(), (e) => ({ path: `/events/${e.slug}`, image: e.photos[0] })),
    entries(() => getCommunityServices(), (c) => ({ path: `/community/${c.slug}`, image: c.photos[0] })),
  ]);

  return [
    ...STATIC.map(({ path, priority, changeFrequency }) => ({
      url: absoluteUrl(path),
      changeFrequency,
      priority,
    })),
    ...listings.flat(),
  ];
}
