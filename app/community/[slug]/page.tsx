import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ageLimitLabel, getCommunityService } from "@/lib/community";
import { getMyPhone } from "@/lib/profile";
import { islandLabel } from "@/lib/islands";
import { absoluteUrl, andamanAddress, clip, listingMetadata, offer } from "@/lib/seo";
import JsonLd from "@/app/json-ld";
import { CalendarIcon, PhoneIcon, PinIcon } from "@/app/icons";
import DirectionsButton from "@/app/directions-button";
import PhotoCarousel from "@/app/photo-carousel";
import ExpandableText from "@/app/expandable-text";
import ShareRow from "@/app/share-row";
import PageBack from "@/app/page-back";
import InterestPanel from "./interest-panel";

// Reads Supabase fresh on every request — see lib/supabase.ts — so this
// route can't be pre-generated.
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const service = await getCommunityService(slug);

  if (!service) return { title: "Andaman Go" };

  // Falls back to the site's own app/opengraph-image.png (the generic brand
  // card) when the organiser hasn't added a photo — see listingMetadata().
  return listingMetadata({
    title: `${service.name}, ${islandLabel(service.islandSlug)} — Andaman Go`,
    description: service.about,
    path: `/community/${slug}`,
    image: service.photos[0],
  });
}

export default async function CommunityServicePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [service, phone] = await Promise.all([getCommunityService(slug), getMyPhone()]);

  if (!service) notFound();

  const ages = ageLimitLabel(service);

  const brief: { label: string; value: string }[] = [
    { label: "Meeting point", value: service.meetingPoint },
    ...(service.whatToBring ? [{ label: "What to bring", value: service.whatToBring }] : []),
    ...(service.safetyNotes ? [{ label: "Safety notes", value: service.safetyNotes }] : []),
    ...(ages ? [{ label: "Age limits", value: ages }] : []),
  ];

  return (
    <main className="page-well pt-[calc(var(--safe-top)+1.5rem)] pb-40 lg:grid lg:grid-cols-12 lg:gap-x-12 lg:pt-8 lg:pb-24">
      <JsonLd
        data={{
          "@type": "Event",
          name: service.name,
          description: clip(service.about, 500),
          image: service.photos.length > 0 ? service.photos : undefined,
          url: absoluteUrl(`/community/${slug}`),
          startDate: service.startsAt,
          eventStatus: "https://schema.org/EventScheduled",
          eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
          location: {
            "@type": "Place",
            name: service.meetingPoint,
            address: andamanAddress(islandLabel(service.islandSlug)),
            hasMap: service.mapsUrl ?? undefined,
          },
          organizer: { "@type": "Organization", name: service.organizerName },
          isAccessibleForFree: true,
          offers: offer(0, `/community/${slug}`),
        }}
      />
      <div className="lg:col-span-7">
      <PageBack href="/community" variant="text" label="All community activities" />

      <PhotoCarousel photos={service.photos} alt={service.name} />

      <div className="mt-4 flex gap-3">
        <div className="font-display flex h-[62px] w-[62px] shrink-0 items-center justify-center rounded-2xl bg-brandsoft text-xl font-bold text-brand">
          {service.mark}
        </div>
        <div className="min-w-0">
          <h1 className="font-display text-[22px] lg:text-page leading-tight font-bold tracking-tight">
            {service.name}
          </h1>
          <p className="mt-1 text-[12.5px] font-semibold text-brand">{service.organizerName}</p>
          <span className="mt-2 inline-flex w-fit rounded-full bg-brandsoft px-2.5 py-1 text-[11px] font-bold text-brand">
            Free · I&apos;m interested
          </span>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4 text-[13px] font-semibold">
        <span className="flex items-center gap-2">
          <CalendarIcon size={15} className="shrink-0 text-brand" />
          {service.dayLabel} {service.dayNum} · {service.timeLabel}
          {service.endTimeLabel && `–${service.endTimeLabel}`}
        </span>
        <span className="flex items-center gap-2">
          <PinIcon size={15} className="shrink-0 text-brand" />
          {service.meetingPoint}
        </span>
        <span className="flex items-center gap-2 text-muted">
          <PhoneIcon size={15} className="shrink-0 text-brand" />
          {service.contactName} · {service.contactPhone}
        </span>
      </div>

      {service.mapsUrl && (
        <div className="mt-4">
          <DirectionsButton
            directions={{
              addressLabel: null,
              query: `${service.meetingPoint}, Andaman`,
              mapsUrl: service.mapsUrl,
            }}
          />
        </div>
      )}

      {service.about && (
        <ExpandableText text={service.about} className="mt-4 text-[14px] leading-relaxed text-muted" />
      )}

      <div className="mt-6 flex flex-col gap-3">
        {brief.map((row) => (
          <div key={row.label} className="border-t border-hairline pt-3">
            <p className="text-[11.5px] font-bold tracking-wide text-muted uppercase">{row.label}</p>
            <p className="mt-1 text-[13.5px] leading-relaxed whitespace-pre-line text-ink">
              {row.value}
            </p>
          </div>
        ))}
      </div>

      </div>

      <div className="lg:sticky lg:top-24 lg:col-span-5 lg:col-start-8 lg:row-span-2 lg:row-start-1 lg:max-h-[calc(100vh-7rem)] lg:self-start lg:overflow-y-auto lg:[scrollbar-width:thin] lg:rounded-panel lg:border lg:border-line lg:bg-surface lg:p-6 lg:shadow-card lg:[&>:first-child]:mt-0">
        <InterestPanel service={service} initialPhone={phone} />
        <ShareRow title={service.name} />
      </div>
    </main>
  );
}
