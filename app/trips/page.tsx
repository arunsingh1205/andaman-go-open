import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { getTrips, seatsLeft, seatsToConfirm } from "@/lib/trips";
import { rupees } from "@/lib/activities";
import { currentIslandSlug } from "@/lib/current-island";
import { ShieldIcon } from "@/app/icons";
import BottomNav from "@/app/bottom-nav";
import PageBack from "@/app/page-back";
import SelectedIsland from "@/app/selected-island";
import Rating from "@/app/rating";

// Reads Supabase fresh on every request — see lib/supabase.ts.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Island day trips & adventures in the Andamans — Andaman Go",
  description:
    "Whole days out in Havelock, Port Blair and Neil — island hopping, treks, kayaking and boat trips, planned and run by local hosts. See what's included and book a seat online.",
  alternates: { canonical: "/trips" },
};

const DIFFICULTY_LABEL = {
  easy: "Easy",
  moderate: "Moderate",
  challenging: "Challenging",
} as const;

export default async function TripsPage() {
  const trips = await getTrips(await currentIslandSlug());

  return (
    <>
      {/* Same white bar + safe-area treatment as Activities. */}
      <header className="sticky top-0 z-30 border-b border-hairline bg-surface">
        <div className="page-well pt-[calc(var(--safe-top)+1.5rem)] pb-3.5 lg:pt-10 lg:pb-6">
          <div className="flex items-center gap-3">
            <PageBack href="/explore" />
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-[19px] lg:text-page font-bold tracking-tight">
                Island Adventures
              </h1>
              <p className="text-[12px] font-medium text-muted">
                <SelectedIsland suffix={`${trips.length} to book`} />
              </p>
            </div>
          </div>
          <p className="mt-2.5 flex items-center gap-1.5 text-[11.5px] font-semibold text-brand">
            <ShieldIcon size={13} className="shrink-0" />
            A whole day, planned and run by someone who lives here
          </p>
        </div>
      </header>

      <main className="page-well pt-4 pb-32 lg:pt-8 lg:pb-24">
        <ul className="flex flex-col gap-4 tablet:grid tablet:grid-cols-2 tablet:gap-4 lg:grid lg:grid-cols-3 lg:gap-5">
          {trips.map((t) => {
            const left = seatsLeft(t);
            const toGo = seatsToConfirm(t);

            return (
              <li key={t.slug}>
                <Link
                  href={`/trips/${t.slug}`}
                  className="card-hover block overflow-hidden rounded-panel border border-line bg-surface transition active:scale-[0.985] lg:flex lg:h-full lg:flex-col lg:active:scale-100"
                >
                  <div className="relative h-40 w-full lg:h-48 lg:shrink-0">
                    {t.photos.length > 0 ? (
                      <Image
                        src={t.photos[0]}
                        alt=""
                        fill
                        sizes="(min-width: 1024px) 380px, (min-width: 768px) 400px, 100vw"
                        loading="lazy"
                        className="object-cover"
                      />
                    ) : (
                      <div className="font-display flex h-40 w-full items-center lg:h-48 justify-center bg-brandsoft text-[38px] font-bold text-brand">
                        {t.title.charAt(0)}
                      </div>
                    )}
                    <span className="absolute top-3 left-3 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-bold text-brand">
                      {DIFFICULTY_LABEL[t.difficulty]}
                    </span>
                    <span className="absolute right-3 bottom-3 rounded-full bg-white/95 px-3 py-1.5 text-[14px] font-bold text-brand shadow-sm">
                      {rupees(t.pricePaise)}
                      <span className="text-[10.5px] font-semibold text-muted"> / person</span>
                    </span>
                  </div>

                  <div className="p-4 lg:flex lg:flex-1 lg:flex-col lg:p-5">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-[16px] leading-tight font-bold">{t.title}</p>
                      <Rating
                        rating={t.rating}
                        reviews={t.reviews}
                        size={14}
                        className="shrink-0 pt-0.5"
                      />
                    </div>
                    <p className="mt-1.5 text-[12px] font-semibold text-brand">
                      {[t.host, t.hostSince].filter(Boolean).join(" · ")}
                    </p>
                    <p className="mt-1 line-clamp-2 text-[12px] font-medium text-muted">
                      {t.summary}
                    </p>

                    <div className="hidden lg:block lg:flex-1" aria-hidden />

                    <div className="mt-3 flex items-center justify-between border-t border-hairline pt-3 text-[12px] font-semibold">
                      <span className="text-muted">
                        {t.island} · {t.durationLabel}
                      </span>
                      <span
                        className={
                          !t.isOpen || toGo > 0 || left <= 3 ? "text-warn" : "text-muted"
                        }
                      >
                        {!t.isOpen
                          ? "Next date closed"
                          : toGo > 0
                            ? `${toGo} more to run`
                            : left === Infinity
                              ? "Seats open"
                              : `${left} seat${left === 1 ? "" : "s"} left`}
                      </span>
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>

        {trips.length === 0 && (
          <p className="mt-10 text-center text-[13.5px] text-muted">
            No adventures run from here yet — try another island.
          </p>
        )}
      </main>

      <BottomNav />
    </>
  );
}
