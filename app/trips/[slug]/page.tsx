import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTrip } from "@/lib/trips";
import { rupees } from "@/lib/activities";
import { absoluteUrl, aggregateRating, clip, listingMetadata, offer } from "@/lib/seo";
import JsonLd from "@/app/json-ld";
import ViewBeacon from "@/app/view-beacon";
import ListingReviews from "@/app/listing-reviews";
import PhotoCarousel from "@/app/photo-carousel";
import Rating from "@/app/rating";
import ShareButton from "@/app/share-button";
import StickyBookBar from "@/app/sticky-book-bar";
import PageBack from "@/app/page-back";
import TripBook from "./trip-book";

// Reads Supabase fresh on every request — see lib/supabase.ts.
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const trip = await getTrip(slug);

  if (!trip) return { title: "Andaman Go" };

  return listingMetadata({
    title: `${trip.title}${trip.island ? `, ${trip.island}` : ""} — Andaman Go`,
    description: trip.summary,
    path: `/trips/${slug}`,
    image: trip.photos[0],
  });
}

export default async function TripPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const trip = await getTrip(slug);

  if (!trip) notFound();

  return (
    <>
      <ViewBeacon kind="trip" subject={slug} />
      <JsonLd
        data={{
          "@type": "Product",
          name: trip.title,
          description: clip(trip.summary, 500),
          image: trip.photos.length > 0 ? trip.photos : undefined,
          url: absoluteUrl(`/trips/${slug}`),
          brand: { "@type": "Organization", name: trip.host },
          offers: offer(trip.pricePaise, `/trips/${slug}`, trip.isOpen),
          aggregateRating: aggregateRating(trip.rating, trip.reviews),
        }}
      />
      <div className="sticky top-0 z-30 border-b border-hairline bg-surface">
        <div className="page-well flex items-start gap-3 pt-[calc(var(--safe-top)+1.5rem)] pb-4 lg:pt-10 lg:pb-6">
          <PageBack href="/trips" className="-mt-1 shrink-0" />
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-[19px] lg:text-page leading-tight font-bold tracking-tight">
              {trip.title}
            </h1>
            <p className="mt-1 text-[12px] font-semibold text-brand">
              {[trip.host, trip.hostSince].filter(Boolean).join(" · ")}
            </p>
            <p className="mt-1 text-[12px] font-medium text-muted">
              {trip.island} · {trip.durationLabel}
            </p>
          </div>
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-ground px-2.5 py-1.5">
            <Rating rating={trip.rating} reviews={trip.reviews} />
          </span>
          <ShareButton title={trip.title} className="-mt-1 -mr-2" />
        </div>
      </div>

      <main className="page-well pb-32 lg:grid lg:grid-cols-12 lg:gap-x-12 lg:pt-8 lg:pb-24">
        <div className="lg:col-span-7">
          <PhotoCarousel photos={trip.photos} alt={trip.title} />
        </div>
        <div id="book" className="lg:contents">
          <TripBook trip={trip} />
        </div>
        <div className="lg:col-span-7">
          <ListingReviews kind="trip" slug={slug} />
        </div>
      </main>

      <StickyBookBar label={`From ${rupees(trip.pricePaise)}`} hint="per person" />
    </>
  );
}