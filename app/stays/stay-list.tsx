"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { rupees } from "@/lib/activities";
import { PROPERTY_TYPE_LABEL, type Stay } from "@/lib/stays";
import Rating from "@/app/rating";

const FILTERS: { id: "all" | Stay["propertyType"]; label: string }[] = [
  { id: "all", label: "All" },
  { id: "homestay", label: "Homestays" },
  { id: "guesthouse", label: "Guesthouses" },
  { id: "villa", label: "Villas" },
  { id: "resort", label: "Resorts" },
  { id: "hostel", label: "Hostels" },
  { id: "hotel", label: "Hotels" },
];

type SortId = "rating" | "price_asc" | "price_desc";

const SORTS: { id: SortId; label: string }[] = [
  { id: "rating", label: "Best reviewed" },
  { id: "price_asc", label: "Price: low to high" },
  { id: "price_desc", label: "Price: high to low" },
];

/** The lowest nightly rate across room types, in paise — Infinity when the
 *  property has none yet, so it sorts last either direction. */
function fromPaise(stay: Stay): number {
  if (stay.roomTypes.length === 0) return Infinity;
  return Math.min(...stay.roomTypes.map((r) => r.nightlyRatePaise));
}

function ratingValue(stay: Stay): number {
  const n = Number(stay.rating);
  return Number.isFinite(n) ? n : 0;
}

function fromRateLine(stay: Stay): string {
  const paise = fromPaise(stay);
  return Number.isFinite(paise) ? `From ${rupees(paise)} / night` : "Booking opens soon";
}

/** Extra query params (dates, guests) a traveller already chose on the
 *  search step — carried through to the detail page so BookPanel opens
 *  pre-filled instead of asking again. */
export default function StayList({
  stays,
  searchQuery = "",
}: {
  stays: Stay[];
  searchQuery?: string;
}) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [sort, setSort] = useState<SortId>("rating");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");

  const byPropertyType = stays.filter((s) => filter === "all" || s.propertyType === filter);

  const priced = useMemo(() => {
    const min = minPrice.trim() === "" ? null : Number(minPrice) * 100;
    const max = maxPrice.trim() === "" ? null : Number(maxPrice) * 100;
    if (min === null && max === null) return byPropertyType;
    return byPropertyType.filter((s) => {
      const p = fromPaise(s);
      if (!Number.isFinite(p)) return false;
      if (min !== null && p < min) return false;
      if (max !== null && p > max) return false;
      return true;
    });
  }, [byPropertyType, minPrice, maxPrice]);

  const shown = useMemo(() => {
    const copy = [...priced];
    if (sort === "price_asc") copy.sort((a, b) => fromPaise(a) - fromPaise(b));
    else if (sort === "price_desc") copy.sort((a, b) => fromPaise(b) - fromPaise(a));
    else copy.sort((a, b) => ratingValue(b) - ratingValue(a));
    return copy;
  }, [priced, sort]);

  return (
    <>
      <div className="no-bar -mx-5 flex gap-2 overflow-x-auto px-5 pb-1 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0">
        {FILTERS.map((f) => {
          const count =
            f.id === "all" ? stays.length : stays.filter((s) => s.propertyType === f.id).length;
          if (count === 0 && f.id !== "all") return null;

          const on = f.id === filter;
          return (
            <button
              key={f.id}
              type="button"
              aria-pressed={on}
              onClick={() => setFilter(f.id)}
              className={`h-9 shrink-0 rounded-full border px-3.5 text-[12.5px] font-semibold transition ${
                on ? "border-brand bg-brand text-white" : "border-line bg-surface text-muted"
              }`}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2.5">
        <label className="flex items-center gap-1.5 text-[12px] font-semibold text-muted">
          Sort
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortId)}
            className="h-9 rounded-xl border border-line bg-surface px-2.5 text-[12.5px] font-semibold text-ink outline-none focus:border-brand"
          >
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1.5 text-[12px] font-semibold text-muted">
          ₹
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={minPrice}
            onChange={(e) => setMinPrice(e.target.value)}
            placeholder="Min"
            className="h-9 w-[76px] rounded-xl border border-line bg-surface px-2.5 text-[12.5px] font-semibold text-ink outline-none focus:border-brand"
          />
        </label>
        <span className="text-[12px] font-semibold text-muted">–</span>
        <label className="flex items-center gap-1.5 text-[12px] font-semibold text-muted">
          ₹
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
            placeholder="Max"
            className="h-9 w-[76px] rounded-xl border border-line bg-surface px-2.5 text-[12.5px] font-semibold text-ink outline-none focus:border-brand"
          />
        </label>
        <span className="text-[11px] font-medium text-muted">per night</span>

        {(minPrice.trim() !== "" || maxPrice.trim() !== "") && (
          <button
            type="button"
            onClick={() => {
              setMinPrice("");
              setMaxPrice("");
            }}
            className="text-[11.5px] font-bold text-brand underline"
          >
            Clear
          </button>
        )}
      </div>

      <ul className="mt-4 flex flex-col gap-4 tablet:grid tablet:grid-cols-2 tablet:gap-4 lg:mt-6 lg:grid lg:grid-cols-3 lg:gap-5">
        {shown.map((s) => (
          <li key={s.slug}>
            <Link
              href={`/stays/${s.slug}${searchQuery}`}
              className="card-hover block overflow-hidden rounded-panel border border-line bg-surface transition active:scale-[0.985] lg:flex lg:h-full lg:flex-col lg:active:scale-100"
            >
              <div className="relative h-40 w-full lg:h-48 lg:shrink-0">
                {s.photos.length > 0 ? (
                  <Image
                    src={s.photos[0]}
                    alt=""
                    fill
                    sizes="(min-width: 1024px) 380px, (min-width: 768px) 400px, 100vw"
                    loading="lazy"
                    className="object-cover"
                  />
                ) : (
                  <div className="font-display flex h-40 w-full items-center lg:h-48 justify-center bg-brandsoft text-[38px] font-bold text-brand">
                    {s.mark}
                  </div>
                )}
                <span className="absolute top-3 left-3 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-bold text-brand">
                  {PROPERTY_TYPE_LABEL[s.propertyType]}
                </span>
              </div>

              <div className="p-4 lg:flex lg:flex-1 lg:flex-col lg:p-5">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[16px] leading-tight font-bold">{s.name}</p>
                  <Rating rating={s.rating} reviews={s.reviews} size={14} className="shrink-0 pt-0.5" />
                </div>
                <p className="mt-1.5 text-[12px] font-semibold text-brand">{s.area}</p>
                {s.tagline && (
                  <p className="mt-1 line-clamp-2 text-[12px] font-medium text-muted">{s.tagline}</p>
                )}

                <div className="hidden lg:block lg:flex-1" aria-hidden />

                <div className="mt-3 flex items-center justify-between border-t border-hairline pt-3 text-[13px] font-bold">
                  <span>{fromRateLine(s)}</span>
                  <span className="text-[11.5px] font-semibold text-muted">
                    {s.roomTypes.length} room type{s.roomTypes.length === 1 ? "" : "s"}
                  </span>
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>

      {shown.length === 0 && (
        <p className="mt-10 text-center text-[13.5px] text-muted">
          Nothing matches that filter yet.
        </p>
      )}
    </>
  );
}
