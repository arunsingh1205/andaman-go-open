import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getStay, AMENITY_LABEL, PROPERTY_TYPE_LABEL, type StayAmenity } from "@/lib/stays";
import { rupees } from "@/lib/activities";
import { absoluteUrl, aggregateRating, andamanAddress, clip, listingMetadata } from "@/lib/seo";
import JsonLd from "@/app/json-ld";
import { StarIcon, CheckIcon, ClockIcon } from "@/app/icons";
import ViewBeacon from "@/app/view-beacon";
import ListingReviews from "@/app/listing-reviews";
import PhotoCarousel from "@/app/photo-carousel";
import ExpandableText from "@/app/expandable-text";
import ShareButton from "@/app/share-button";
import PageBack from "@/app/page-back";
import BookPanel from "./book-panel";

// Room-type availability comes from Supabase fresh on every request — see
// lib/supabase.ts — so this route can't be pre-generated.
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const stay = await getStay(slug);

  if (!stay) return { title: "Andaman Go" };

  return listingMetadata({
    title: `${stay.name} — ${PROPERTY_TYPE_LABEL[stay.propertyType]} in ${stay.area || stay.island} | Andaman Go`,
    description: stay.about || stay.tagline,
    path: `/stays/${slug}`,
    image: stay.photos[0],
  });
}

/** Minutes past midnight as schema.org wants a time of day — "14:00:00". */
function isoClock(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  return `${String(h).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}:00`;
}

function fmtClock(mins: number): string {
  const h24 = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const suffix = h24 < 12 ? "AM" : "PM";
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${String(m).padStart(2, "0")} ${suffix}`;
}

export default async function StayPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ checkin?: string; checkout?: string; guests?: string }>;
}) {
  const { slug } = await params;
  const search = await searchParams;
  const stay = await getStay(slug);

  if (!stay) notFound();

  return (
    <main className="page-well pt-[calc(var(--safe-top)+1.5rem)] pb-40 lg:grid lg:grid-cols-12 lg:gap-x-12 lg:pt-8 lg:pb-24">
      <ViewBeacon kind="stay" subject={slug} />
      <JsonLd
        data={{
          "@type": "LodgingBusiness",
          name: stay.name,
          description: clip(stay.about || stay.tagline, 500),
          image: stay.photos.length > 0 ? stay.photos : undefined,
          url: absoluteUrl(`/stays/${slug}`),
          address: andamanAddress(stay.area || stay.island),
          checkinTime: isoClock(stay.checkInMins),
          checkoutTime: isoClock(stay.checkOutMins),
          priceRange:
            stay.roomTypes.length > 0
              ? `From ${rupees(Math.min(...stay.roomTypes.map((r) => r.nightlyRatePaise)))} a night`
              : undefined,
          amenityFeature: stay.amenities.map((a) => ({
            "@type": "LocationFeatureSpecification",
            name: AMENITY_LABEL[a as StayAmenity] ?? a,
            value: true,
          })),
          aggregateRating: aggregateRating(stay.rating, stay.reviews),
        }}
      />
      <div className="lg:col-span-7">
      {/* ml-auto, not justify-between — see activities/[slug]/page.tsx */}
      <div className="flex items-center">
        <PageBack
          href={
            search.checkin || search.checkout || search.guests
              ? `/stays/results?${new URLSearchParams(
                  Object.entries(search).filter(([, v]) => v) as [string, string][],
                ).toString()}`
              : "/stays"
          }
          variant="text"
          label="All stays"
        />
        <ShareButton title={stay.name} className="ml-auto -mr-2" />
      </div>

      <PhotoCarousel photos={stay.photos} alt={stay.name} />

      <div className="mt-4 flex gap-3">
        <div className="font-display flex h-[62px] w-[62px] shrink-0 items-center justify-center rounded-2xl bg-brandsoft text-xl font-bold text-brand">
          {stay.mark}
        </div>
        <div className="min-w-0">
          <h1 className="font-display text-[22px] lg:text-page leading-tight font-bold tracking-tight">
            {stay.name}
          </h1>
          <p className="mt-1 text-[12.5px] font-semibold text-brand">
            {PROPERTY_TYPE_LABEL[stay.propertyType]} · {stay.area}
          </p>
          <p className="mt-1 flex items-center gap-1.5">
            {stay.reviews > 0 ? (
              <>
                <StarIcon size={14} className="text-sand" />
                <span className="text-[12.5px] font-bold">{stay.rating}</span>
                <span className="text-[12px] font-medium text-muted">({stay.reviews})</span>
              </>
            ) : (
              <span className="text-[12px] font-medium text-muted">New listing</span>
            )}
          </p>
        </div>
      </div>

      {stay.tagline && <p className="mt-3 text-[13.5px] font-semibold text-ink">{stay.tagline}</p>}
      {stay.about && (
        <ExpandableText text={stay.about} className="mt-2 text-[14px] leading-relaxed text-muted" />
      )}

      <div className="mt-4 flex items-center gap-2 rounded-2xl border border-line bg-ground px-4 py-3">
        <ClockIcon size={16} className="shrink-0 text-brand" />
        <span className="text-[12.5px] font-semibold">
          Check-in {fmtClock(stay.checkInMins)} · Check-out {fmtClock(stay.checkOutMins)}
        </span>
      </div>

      {stay.amenities.length > 0 && (
        <div className="mt-4">
          <p className="text-[12px] font-bold tracking-wider text-muted uppercase">Amenities</p>
          <ul className="mt-2 grid grid-cols-2 gap-2">
            {stay.amenities.map((a) => (
              <li key={a} className="flex items-center gap-1.5 text-[12.5px] font-medium">
                <CheckIcon size={13} className="shrink-0 text-brand" />
                {AMENITY_LABEL[a as StayAmenity] ?? a}
              </li>
            ))}
          </ul>
        </div>
      )}

      {stay.houseRules && (
        <div className="mt-4">
          <p className="text-[12px] font-bold tracking-wider text-muted uppercase">House rules</p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{stay.houseRules}</p>
        </div>
      )}

      </div>

      <div id="book" className="lg:sticky lg:top-24 lg:col-span-5 lg:col-start-8 lg:row-span-2 lg:row-start-1 lg:max-h-[calc(100vh-7rem)] lg:self-start lg:overflow-y-auto lg:[scrollbar-width:thin] lg:[&>:first-child]:mt-0">
        <BookPanel
          stay={stay}
          commissionBps={stay.commissionBps}
          initialCheckIn={search.checkin}
          initialCheckOut={search.checkout}
          initialGuests={search.guests ? Number(search.guests) : undefined}
        />
      </div>

      <div className="lg:col-span-7">
        <ListingReviews kind="stay" slug={slug} />
      </div>
    </main>
  );
}
