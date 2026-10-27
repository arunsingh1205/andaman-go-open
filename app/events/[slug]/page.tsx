import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AGE_RESTRICTION_LABEL, getEvent, getEventOccurrences, GENRE_LABEL } from "@/lib/events";
import { rupees } from "@/lib/activities";
import { absoluteUrl, andamanAddress, clip, listingMetadata, offer } from "@/lib/seo";
import JsonLd from "@/app/json-ld";
import { MusicIcon, StarIcon } from "@/app/icons";
import DirectionsButton from "@/app/directions-button";
import ViewBeacon from "@/app/view-beacon";
import ListingReviews from "@/app/listing-reviews";
import PhotoCarousel from "@/app/photo-carousel";
import ExpandableText from "@/app/expandable-text";
import ShareButton from "@/app/share-button";
import StickyBookBar from "@/app/sticky-book-bar";
import PageBack from "@/app/page-back";
import RsvpPanel from "./rsvp-panel";
import EventDateChips from "./event-date-chips";

// Reads Supabase fresh on every request — see lib/supabase.ts — so this
// route can't be pre-generated.
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const event = await getEvent(slug);

  if (!event) return { title: "Andaman Go" };

  return listingMetadata({
    title: `${event.name} at ${event.venue}, ${event.dayLabel} ${event.dayNum} — Andaman Go`,
    description: event.about,
    path: `/events/${slug}`,
    image: event.photos[0],
  });
}

export default async function EventPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const { slug } = await params;
  const { date } = await searchParams;
  const [event, occurrences] = await Promise.all([
    getEvent(slug, date),
    getEventOccurrences(slug),
  ]);

  if (!event) notFound();

  return (
    <main className="page-well pt-[calc(var(--safe-top)+1.5rem)] pb-40 lg:grid lg:grid-cols-12 lg:gap-x-12 lg:pt-8 lg:pb-24">
      <ViewBeacon kind="event" subject={slug} />
      <JsonLd
        data={{
          "@type": "Event",
          name: event.name,
          description: clip(event.about, 500),
          image: event.photos.length > 0 ? event.photos : undefined,
          url: absoluteUrl(`/events/${slug}`),
          startDate: event.startsAt,
          eventStatus: "https://schema.org/EventScheduled",
          eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
          location: {
            "@type": "Place",
            name: event.venue,
            address: andamanAddress(event.area),
            hasMap: event.mapsUrl ?? undefined,
          },
          performer: event.performer ? { "@type": "PerformingGroup", name: event.performer } : undefined,
          isAccessibleForFree: event.entryPaise === 0,
          offers: offer(
            event.entryPaise,
            `/events/${slug}`,
            event.capacity == null || event.going < event.capacity,
          ),
        }}
      />
      <div className="lg:col-span-7">
      {/* ml-auto, not justify-between — see activities/[slug]/page.tsx */}
      <div className="flex items-center">
        <PageBack href="/events" variant="text" label="All events" />
        <ShareButton title={event.name} className="ml-auto -mr-2" />
      </div>

      <PhotoCarousel photos={event.photos} alt={event.name} />

      <div className="mt-4 flex gap-3">
        <div className="font-display flex h-[62px] w-[62px] shrink-0 items-center justify-center rounded-2xl bg-brandsoft text-xl font-bold text-brand">
          {event.mark}
        </div>
        <div className="min-w-0">
          <h1 className="font-display text-[22px] lg:text-page leading-tight font-bold tracking-tight">
            {event.name}
          </h1>
          <p className="mt-1 text-[12.5px] font-semibold text-brand">
            {GENRE_LABEL[event.genre]} · {event.dayLabel} {event.dayNum}, {event.timeLabel}
            {event.endTimeLabel && `–${event.endTimeLabel}`}
          </p>
          {event.performer && (
            <p className="mt-1 flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
              <MusicIcon size={13} className="shrink-0 text-brand" />
              {event.performer}
            </p>
          )}
          <p className="mt-1 flex items-center gap-1.5">
            {event.reviews > 0 && <StarIcon size={14} className="text-sand" />}
            {event.reviews > 0 && (
              <span className="text-[12.5px] font-bold">{event.rating}</span>
            )}
            <span className="text-[12px] font-medium text-muted">
              {event.reviews > 0 ? `(${event.reviews})` : "New"} · {event.venue}
            </span>
          </p>
          {event.ageRestriction !== "all-ages" && (
            <span className="mt-2 inline-flex w-fit rounded-full bg-sandsoft px-2.5 py-1 text-[11px] font-bold text-sandink">
              {AGE_RESTRICTION_LABEL[event.ageRestriction]} only
            </span>
          )}
        </div>
      </div>

      <EventDateChips slug={slug} occurrences={occurrences} selectedDayKey={event.dayKey} />

      {event.mapsUrl && (
        <div className="mt-4">
          <DirectionsButton
            directions={{
              addressLabel: null,
              query: `${event.venue}, ${event.area}, Andaman`,
              mapsUrl: event.mapsUrl,
            }}
          />
        </div>
      )}

      <ExpandableText
        text={event.about}
        className="mt-4 text-[14px] leading-relaxed text-muted lg:text-[15.5px]"
      />
      </div>

      <div id="book" className="lg:sticky lg:top-24 lg:col-span-5 lg:col-start-8 lg:row-span-2 lg:row-start-1 lg:max-h-[calc(100vh-7rem)] lg:self-start lg:overflow-y-auto lg:[scrollbar-width:thin] lg:rounded-panel lg:border lg:border-line lg:bg-surface lg:p-6 lg:shadow-card lg:[&>:first-child]:mt-0">
        <RsvpPanel event={event} />
      </div>

      <div className="lg:col-span-7">
        <ListingReviews kind="event" slug={slug} />
      </div>

      <StickyBookBar
        label={
          event.entryPaise > 0
            ? `${event.tickets.length > 1 ? "From " : ""}${rupees(event.entryPaise)} entry`
            : "Free entry"
        }
        hint="reserve your spot"
      />
    </main>
  );
}
