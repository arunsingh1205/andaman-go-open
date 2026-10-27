import Link from "next/link";
import Image from "next/image";
import { getTrips, seatsLeft, type Trip } from "@/lib/trips";
import { rupees } from "@/lib/activities";
import Rating from "./rating";

// app/explore/page.tsx already fetches trips itself (in parallel with
// everything else the home screen needs, to avoid this component adding its
// own sequential round trip on top) and passes them straight in. Only
// app/plan/page.tsx still calls this with no `trips` prop, so the fetch
// stays here as a fallback for that caller rather than forcing every caller
// to fetch trips themselves.
export default async function TripStrip({
  islandSlug,
  trips: providedTrips,
}: {
  islandSlug?: string;
  trips?: Trip[];
}) {
  const trips = providedTrips ?? (await getTrips(islandSlug));

  if (trips.length === 0) return null;

  return (
    <section className="mt-7 lg:mt-16">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[12px] font-bold tracking-wider text-muted uppercase lg:font-display lg:text-[24px] lg:tracking-tight lg:text-ink lg:normal-case">
          Island Adventures
        </h3>
        <Link href="/trips" className="text-[12.5px] font-bold text-brand lg:text-[14px] lg:hover:underline">
          See all
        </Link>
      </div>

      <p className="mt-1.5 text-[12.5px] leading-snug font-medium text-muted lg:mt-1 lg:text-[14px]">
        A whole day, planned and run by someone who lives here.
      </p>

      <div className="no-bar -mx-5 mt-3 flex gap-3 overflow-x-auto px-5 pb-1 tablet:-mx-8 tablet:px-8 lg:mx-0 lg:mt-6 lg:grid lg:grid-cols-3 lg:gap-5 lg:overflow-visible lg:px-0 lg:pb-0">
        {trips.map((t) => (
          <Link
            key={t.slug}
            href={`/trips/${t.slug}`}
            className="card-hover flex w-[248px] shrink-0 flex-col rounded-card border border-line bg-surface p-4 transition active:scale-[0.985] lg:w-auto lg:p-5 lg:active:scale-100"
          >
            {t.photos.length > 0 && (
              <div className="relative mb-2.5 h-28 w-full overflow-hidden rounded-xl border border-line lg:mb-3.5 lg:h-44">
                <Image src={t.photos[0]} alt="" fill sizes="(min-width: 1024px) 380px, 248px" loading="lazy" className="object-cover" />
              </div>
            )}
            <span className="flex items-center gap-1.5">
              <Rating rating={t.rating} reviews={t.reviews} />
              <span className="ml-auto text-[11.5px] font-semibold text-muted">
                {t.island}
              </span>
            </span>

            <span className="mt-2 block text-[15px] leading-snug font-bold">{t.title}</span>

            <span className="mt-1 block text-[12px] font-medium text-muted">
              {t.durationLabel}
            </span>

            <span className="mt-3 flex items-end justify-between border-t border-hairline pt-3">
              <span className="min-w-0">
                <span className="block text-[16px] font-bold text-brand">
                  {rupees(t.pricePaise)}
                </span>
                <span className="block text-[11px] font-semibold text-muted">
                  per person
                </span>
              </span>
              <span
                className={`text-[11.5px] font-semibold ${
                  seatsLeft(t) <= 3 ? "text-warn" : "text-muted"
                }`}
              >
                {seatsLeft(t) === Infinity
                  ? "Seats open"
                  : `${seatsLeft(t)} seat${seatsLeft(t) === 1 ? "" : "s"} left`}
              </span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}