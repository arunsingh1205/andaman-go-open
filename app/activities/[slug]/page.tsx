import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getActivity, rupees } from "@/lib/activities";
import { getMyPhone } from "@/lib/profile";
import { absoluteUrl, aggregateRating, clip, listingMetadata, offer } from "@/lib/seo";
import JsonLd from "@/app/json-ld";
import ViewBeacon from "@/app/view-beacon";
import ListingReviews from "@/app/listing-reviews";
import PhotoCarousel from "@/app/photo-carousel";
import ExpandableText from "@/app/expandable-text";
import ShareButton from "@/app/share-button";
import StickyBookBar from "@/app/sticky-book-bar";
import PageBack from "@/app/page-back";
import BookingPanel from "./booking-panel";

// Seats and open/closed slots come from Supabase on every read, so this page
// can't be pre-generated — see lib/supabase.ts for why reads are uncached.
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const activity = await getActivity(slug);

  if (!activity) return { title: "Andaman Go" };

  return listingMetadata({
    title: `${activity.name}${activity.area ? `, ${activity.area}` : ""} — Andaman Go`,
    description: activity.about || activity.summary,
    path: `/activities/${slug}`,
    image: activity.photos[0],
  });
}

export default async function ActivityPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [activity, phone] = await Promise.all([getActivity(slug), getMyPhone()]);

  if (!activity) notFound();

  return (
    <main className="page-well pt-[calc(var(--safe-top)+1.5rem)] pb-40 lg:grid lg:grid-cols-12 lg:gap-x-12 lg:pt-8 lg:pb-24">
      <ViewBeacon kind="activity" subject={slug} />
      <JsonLd
        data={{
          "@type": "Product",
          name: activity.name,
          description: clip(activity.about || activity.summary, 500),
          image: activity.photos.length > 0 ? activity.photos : undefined,
          url: absoluteUrl(`/activities/${slug}`),
          brand: { "@type": "Organization", name: activity.operator },
          offers: offer(activity.pricePaise, `/activities/${slug}`),
          aggregateRating: aggregateRating(activity.rating, activity.reviews),
        }}
      />
      <div className="lg:col-span-7">
      {/* ml-auto, not justify-between: PageBack is display:none on iOS
          native (globals.css) once the Liquid Glass back button takes over,
          and with only one visible child left, justify-between collapses
          it to the start instead of the end. ml-auto keeps it pinned right
          either way. */}
      <div className="flex items-center">
        <PageBack href="/activities" variant="text" label="All activities" />
        <ShareButton title={activity.name} className="ml-auto -mr-2" />
      </div>

      <PhotoCarousel photos={activity.photos} alt={activity.name} />

      <div className="mt-4 flex gap-3">
        <div className="font-display flex h-[62px] w-[62px] shrink-0 items-center justify-center rounded-2xl bg-brandsoft text-xl font-bold text-brand">
          {activity.mark}
        </div>
        <div className="min-w-0">
          <h1 className="font-display text-[22px] lg:text-page leading-tight font-bold tracking-tight">
            {activity.name}
          </h1>
          <p className="mt-1 text-[12.5px] font-semibold text-brand">
            {activity.operator}
          </p>
        </div>
      </div>

      <ExpandableText
        text={activity.about}
        className="mt-4 text-[14px] leading-relaxed text-muted lg:text-[15.5px]"
      />
      </div>

      <div id="book" className="lg:sticky lg:top-24 lg:col-span-5 lg:col-start-8 lg:row-span-2 lg:row-start-1 lg:max-h-[calc(100vh-7rem)] lg:self-start lg:overflow-y-auto lg:[scrollbar-width:thin] lg:rounded-panel lg:border lg:border-line lg:bg-surface lg:p-6 lg:shadow-card lg:[&>:first-child]:mt-0">
        <BookingPanel activity={activity} initialPhone={phone} />
      </div>

      <div className="lg:col-span-7">
        <ListingReviews kind="activity" slug={slug} />
      </div>

      <StickyBookBar
        label={`From ${rupees(activity.pricePaise)}`}
        hint={activity.slots.length > 0 ? "per person · pick a time" : "per person"}
      />
    </main>
  );
}