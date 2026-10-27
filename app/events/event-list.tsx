"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { rupees } from "@/lib/activities";
import { GENRE_LABEL, seatsLeft, type DayChip, type EventItem, type Genre } from "@/lib/events";
import { TicketIcon } from "@/app/icons";
import Rating from "@/app/rating";

const FILTERS: { id: "all" | Genre; label: string }[] = [
  { id: "all", label: "All" },
  { id: "dj", label: "DJ" },
  { id: "live", label: "Live music" },
  { id: "bonfire", label: "Bonfire" },
  { id: "karaoke", label: "Karaoke" },
  { id: "comedy", label: "Comedy" },
  { id: "drama", label: "Theatre" },
  { id: "festival", label: "Festival" },
  { id: "carnival", label: "Carnival" },
  { id: "cruise", label: "Dinner cruise" },
];

export default function EventList({
  events,
  days,
}: {
  events: EventItem[];
  days: DayChip[];
}) {
  const [dayKey, setDayKey] = useState(days[0]?.key ?? null);
  const [genre, setGenre] = useState<"all" | Genre>("all");

  if (days.length === 0) {
    return (
      <p className="mt-10 text-center text-[13.5px] text-muted">
        Nothing on this island yet — try another one.
      </p>
    );
  }

  const shown = events.filter(
    (e) => e.dayKey === dayKey && (genre === "all" || e.genre === genre),
  );

  return (
    <>
      <div className="no-bar -mx-5 flex gap-2 overflow-x-auto px-5 pb-1 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0">
        {days.map((d) => {
          const on = d.key === dayKey;
          return (
            <button
              key={d.key}
              type="button"
              aria-pressed={on}
              onClick={() => setDayKey(d.key)}
              className={`h-9 shrink-0 rounded-full border px-3.5 text-[12.5px] font-semibold transition ${
                on ? "border-brand bg-brand text-white" : "border-line bg-surface text-muted"
              }`}
            >
              {d.label} {d.num} {d.month}
            </button>
          );
        })}
      </div>

      <div className="no-bar -mx-5 mt-2.5 flex gap-2 overflow-x-auto px-5 pb-1 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0">
        {FILTERS.map((f) => {
          const on = f.id === genre;
          return (
            <button
              key={f.id}
              type="button"
              aria-pressed={on}
              onClick={() => setGenre(f.id)}
              className={`h-9 shrink-0 rounded-full border px-3.5 text-[12.5px] font-semibold transition ${
                on ? "border-brand bg-brandsoft text-brand" : "border-line bg-surface text-muted"
              }`}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      <ul className="mt-4 flex flex-col gap-4 tablet:grid tablet:grid-cols-2 tablet:gap-4 lg:mt-6 lg:grid lg:grid-cols-3 lg:gap-5">
        {shown.map((e) => {
          const left = seatsLeft(e);
          const soldOut = left === 0;
          return (
            <li key={`${e.slug}-${e.dayKey}`}>
              <Link
                href={`/events/${e.slug}?date=${e.dayKey}`}
                className="card-hover block overflow-hidden rounded-panel border border-line bg-surface transition active:scale-[0.985] lg:flex lg:h-full lg:flex-col lg:active:scale-100"
              >
                <div className="relative h-40 w-full lg:h-48 lg:shrink-0">
                  {e.photos.length > 0 ? (
                    <Image
                      src={e.photos[0]}
                      alt=""
                      fill
                      sizes="(min-width: 1024px) 380px, (min-width: 768px) 400px, 100vw"
                      loading="lazy"
                      className="object-cover"
                    />
                  ) : (
                    <div className="font-display flex h-40 w-full items-center lg:h-48 justify-center bg-brandsoft text-[38px] font-bold text-brand">
                      {e.mark}
                    </div>
                  )}
                  <span className="absolute top-3 left-3 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-bold text-brand">
                    {GENRE_LABEL[e.genre]}
                  </span>
                  <span className="absolute right-3 bottom-3 rounded-full bg-white/95 px-3 py-1.5 text-[14px] font-bold text-brand shadow-sm">
                    {e.entryPaise === 0
                      ? "Free"
                      : `${e.tickets.length > 1 ? "From " : ""}${rupees(e.entryPaise)}`}
                  </span>
                </div>

                <div className="p-4 lg:flex lg:flex-1 lg:flex-col lg:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-[16px] leading-tight font-bold">{e.name}</p>
                    <Rating
                      rating={e.rating}
                      reviews={e.reviews}
                      size={14}
                      className="shrink-0 pt-0.5"
                    />
                  </div>
                  <p className="mt-1.5 text-[12px] font-semibold text-brand">
                    {e.dayLabel} {e.dayNum} · {e.timeLabel}
                    {e.endTimeLabel && `–${e.endTimeLabel}`}
                  </p>
                  <p className="mt-1 text-[12px] font-medium text-muted">
                    {e.venue} · {e.area}
                  </p>
                  {e.recurringLabel && (
                    <p className="mt-1 text-[11.5px] font-semibold text-muted">{e.recurringLabel}</p>
                  )}

                  <div className="hidden lg:block lg:flex-1" aria-hidden />

                  <div className="mt-3 flex items-center gap-1.5 border-t border-hairline pt-3 text-[12px] font-semibold">
                    <TicketIcon size={14} className="shrink-0 text-muted" />
                    <span className={left <= 15 ? "text-warn" : "text-muted"}>
                      {soldOut
                        ? "Sold out"
                        : left === Infinity
                          ? "Open"
                          : `${left} spot${left === 1 ? "" : "s"} left`}
                    </span>
                  </div>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      {shown.length === 0 && (
        <p className="mt-10 text-center text-[13.5px] text-muted">
          Nothing on that day in this category.
        </p>
      )}
    </>
  );
}
