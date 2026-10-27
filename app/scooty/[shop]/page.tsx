import type { Metadata } from "next";
import PageBack from "@/app/page-back";
import { notFound } from "next/navigation";
import { cheapestPaise, getShop, pickupWindow } from "@/lib/rentals";
import { rupees } from "@/lib/activities";
import { absoluteUrl, aggregateRating, andamanAddress, clip, listingMetadata } from "@/lib/seo";
import JsonLd from "@/app/json-ld";
import { dayKey } from "@/lib/date";
import { ShieldIcon, StarIcon } from "@/app/icons";
import ViewBeacon from "@/app/view-beacon";
import ListingReviews from "@/app/listing-reviews";
import ShareButton from "@/app/share-button";
import ShopBooking from "./shop-booking";

// Reads Supabase fresh on every request — see lib/supabase.ts — so this
// route can't be pre-generated.
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ shop: string }>;
}): Promise<Metadata> {
  const { shop: slug } = await params;
  const shop = await getShop(slug);

  if (!shop) return { title: "Andaman Go" };

  const cover = shop.vehicles.find((v) => v.photos.length > 0)?.photos[0];

  return listingMetadata({
    title: `${shop.name} — scooty & bike rental in ${shop.area || shop.island} | Andaman Go`,
    description: shop.blurb,
    path: `/scooty/${slug}`,
    image: cover,
  });
}

export default async function ShopPage({
  params,
}: {
  params: Promise<{ shop: string }>;
}) {
  const { shop: slug } = await params;
  const shop = await getShop(slug);

  if (!shop) notFound();

  // Pick-up can be today if a slot more than 2 hours out remains within the
  // shop's hours; once that closes for the day it moves to tomorrow. Either
  // way the traveller picks a time within the shop's hours so it doesn't
  // silently land at 9 AM and leave the partner guessing (035).
  const { date: pickupDate, options: pickupOptions } = pickupWindow(shop.hours);

  return (
    <>
      <ViewBeacon kind="rental" subject={slug} />
      <JsonLd
        data={{
          "@type": "AutoRental",
          name: shop.name,
          description: clip(shop.blurb, 500),
          image: shop.vehicles.flatMap((v) => v.photos.slice(0, 1)),
          url: absoluteUrl(`/scooty/${slug}`),
          address: andamanAddress(shop.area || shop.island),
          priceRange:
            shop.vehicles.length > 0 ? `From ${rupees(cheapestPaise(shop))} a day` : undefined,
          aggregateRating: aggregateRating(shop.rating, shop.reviews),
        }}
      />
      <div className="sticky top-0 z-30 border-b border-hairline bg-surface">
        <div className="page-well flex items-center gap-3 pt-[calc(var(--safe-top)+1.5rem)] pb-4 lg:pt-10 lg:pb-6">
          <PageBack href="/scooty" />
          <div className="min-w-0 flex-1">
            <h1 className="font-display truncate text-[19px] lg:text-page font-bold tracking-tight">
              {shop.name}
            </h1>
            <p className="mt-0.5 flex items-center gap-1.5 text-[12px] font-semibold text-brand">
              <ShieldIcon size={13} className="shrink-0" />
              Verified · {shop.distance}
            </p>
          </div>
          <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-ground px-2.5 py-1.5">
            <StarIcon size={13} className="text-sand" />
            <span className="text-[12px] font-bold">{shop.rating}</span>
            <span className="text-[11.5px] font-medium text-muted">({shop.reviews})</span>
          </span>
          <ShareButton title={shop.name} className="-mr-2" />
        </div>
      </div>

      <ShopBooking
        shop={shop}
        pickupDateKey={dayKey(pickupDate)}
        pickupOptions={pickupOptions}
      />

      <div className="page-well pb-32 lg:pb-24">
        <div className="lg:max-w-[632px]">
          <ListingReviews kind="rental" slug={slug} />
        </div>
      </div>
    </>
  );
}