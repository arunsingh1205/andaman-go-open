import Link from "next/link";
import Image from "next/image";
import type { FeaturedItem } from "@/lib/featured";
import { ISLANDS } from "@/lib/islands";
import Rating from "./rating";

// Ranking already happened in app/explore/page.tsx, from activities/trips it
// fetched once and shares with app/trip-strip.tsx too — this used to run its
// own getFeatured() here, which re-fetched trips a second time from scratch
// on every single home-screen load, duplicating five of TripStrip's own
// Supabase queries for no reason. Now purely presentational, and no longer
// async since there's nothing left for it to await.
export default function PopularNearby({
  islandSlug,
  items,
}: {
  islandSlug: string;
  items: FeaturedItem[];
}) {
  if (items.length === 0) return null;

  const islandName = ISLANDS.find((i) => i.slug === islandSlug)?.name ?? "the islands";

  return (
    <section className="mt-7 lg:mt-16">
      <h3 className="text-[12px] font-bold tracking-wider text-muted uppercase lg:font-display lg:text-[24px] lg:tracking-tight lg:text-ink lg:normal-case">
        Popular in {islandName}
      </h3>

      <div className="no-bar -mx-5 mt-3 flex gap-3 overflow-x-auto px-5 pb-1 tablet:-mx-8 tablet:px-8 lg:mx-0 lg:mt-6 lg:grid lg:grid-cols-4 lg:gap-5 lg:overflow-visible lg:px-0 lg:pb-0">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="card-hover flex w-[190px] shrink-0 flex-col overflow-hidden rounded-card border border-line bg-surface transition active:scale-[0.985] lg:w-auto lg:active:scale-100"
          >
            <div className="relative h-[128px] w-full lg:h-[176px]">
              <Image src={item.photo} alt="" fill sizes="(min-width: 1024px) 280px, 190px" loading="lazy" className="object-cover" />
            </div>
            <div className="flex min-w-0 flex-1 flex-col p-3 lg:p-4">
              <span className="truncate text-[14px] leading-tight font-bold">{item.name}</span>
              <span className="mt-1 truncate text-[11.5px] font-medium text-muted">{item.sub}</span>

              <span className="mt-2.5 flex items-center justify-between gap-2 border-t border-hairline pt-2.5">
                <Rating rating={item.rating} reviews={item.reviews} size={12} className="shrink-0" />
                <span className="min-w-0 truncate text-[12px] font-bold text-brand">{item.priceLabel}</span>
              </span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
