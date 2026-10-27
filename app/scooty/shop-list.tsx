"use client";

import { useState } from "react";
import Link from "next/link";
import {
  TYPE_LABEL,
  cheapestPaise,
  typesIn,
  type Shop,
  type VehicleType,
} from "@/lib/rentals";
import { rupees } from "@/lib/activities";
import { BicycleIcon, BikeIcon, PinIcon, ScooterIcon, ShieldIcon } from "@/app/icons";
import Rating from "@/app/rating";

const FILTERS: { id: "all" | VehicleType; label: string }[] = [
  { id: "all", label: "All" },
  { id: "scooter", label: "Scooters" },
  { id: "bike", label: "Bikes" },
  { id: "bicycle", label: "Cycles" },
];

const TYPE_ICON = {
  scooter: ScooterIcon,
  bike: BikeIcon,
  bicycle: BicycleIcon,
};

export default function ShopList({ shops }: { shops: Shop[] }) {
  const [filter, setFilter] = useState<"all" | VehicleType>("all");

  const shown = shops.filter(
    (s) => filter === "all" || s.vehicles.some((v) => v.type === filter),
  );

  return (
    <>
      <div className="no-bar -mx-5 flex gap-2 overflow-x-auto px-5 pb-1 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0">
        {FILTERS.map((f) => {
          const on = f.id === filter;
          return (
            <button
              key={f.id}
              type="button"
              aria-pressed={on}
              onClick={() => setFilter(f.id)}
              className={`h-11 shrink-0 rounded-full border px-4 text-[13px] font-semibold ${
                on ? "border-brand bg-brand text-white" : "border-line bg-surface text-muted"
              }`}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      <ul className="mt-4 flex flex-col gap-3 tablet:grid tablet:grid-cols-2 tablet:gap-4 lg:mt-6 lg:grid lg:grid-cols-3 lg:gap-5">
        {shown.map((shop) => {
          const types = typesIn(shop);
          return (
            <li key={shop.slug}>
              <Link
                href={`/scooty/${shop.slug}`}
                className="card-hover block rounded-card border border-line bg-surface p-4 transition active:scale-[0.985] lg:h-full lg:p-5 lg:active:scale-100"
              >
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[15.5px] leading-tight font-bold">{shop.name}</p>
                    <p className="mt-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-brand">
                      <ShieldIcon size={14} className="shrink-0" />
                      Verified
                    </p>
                    {shop.area && (
                      <p className="mt-1 flex items-center gap-1.5 text-[12px] font-semibold text-muted">
                        <PinIcon size={13} className="shrink-0" />
                        {shop.area}
                      </p>
                    )}
                  </div>
                  <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-ground px-2.5 py-1.5">
                    <Rating rating={shop.rating} reviews={shop.reviews} />
                  </span>
                </div>

                <p className="mt-2 text-[12.5px] leading-snug font-medium text-muted">
                  {shop.blurb}
                </p>

                <div className="mt-3 flex items-center justify-between border-t border-hairline pt-3">
                  <span className="flex items-center gap-3">
                    {types.map((t) => {
                      const Icon = TYPE_ICON[t];
                      return (
                        <span key={t} className="flex items-center gap-1.5 text-muted">
                          <Icon size={20} />
                          <span className="text-[11.5px] font-semibold">
                            {TYPE_LABEL[t]}
                          </span>
                        </span>
                      );
                    })}
                  </span>
                  <span className="text-[13px] font-semibold text-muted">
                    from{" "}
                    <span className="text-[15px] font-bold text-brand">
                      {rupees(cheapestPaise(shop))}
                    </span>
                    /day
                  </span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      {shown.length === 0 && (
        <p className="mt-10 text-center text-[13.5px] text-muted">
          Nothing in that category yet on this island.
        </p>
      )}
    </>
  );
}