"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { rupees, seatsLeft, type Activity } from "@/lib/activities";
import { ShieldIcon, ClockIcon, PinIcon } from "@/app/icons";
import Rating from "@/app/rating";
import { ISLANDS, useIsland } from "@/lib/island-context";

const FILTERS: { id: "all" | Activity["category"]; label: string }[] = [
  { id: "all", label: "All" },
  { id: "scuba", label: "Scuba" },
  { id: "seawalk", label: "Sea walk" },
  { id: "snorkel", label: "Snorkel" },
  { id: "water", label: "Water sports" },
  { id: "stargazing", label: "Stargazing" },
];

const CATEGORY_LABEL: Record<Activity["category"], string> = {
  scuba: "Scuba",
  seawalk: "Sea walk",
  snorkel: "Snorkel",
  water: "Water sports",
  stargazing: "Stargazing",
};

// Partners type their own area, so the same beach turns up as "North bay",
// "North Bay" and "Marina park watersports" / "Marina Park, Sri Vijaya
// Puram". Known spots are matched by keyword so each gets one chip; anything
// else falls back to its own text, compared case-insensitively.
const KNOWN_SPOTS: { match: string; label: string }[] = [
  { match: "north bay", label: "North Bay" },
  { match: "chatham", label: "Chatham" },
  { match: "corbyn", label: "Corbyn's Cove" },
  { match: "marina", label: "Marina Park" },
  { match: "ross island", label: "Ross Island" },
  { match: "jolly buoy", label: "Jolly Buoy" },
  { match: "wandoor", label: "Wandoor" },
  { match: "govind", label: "Govind Nagar" },
  { match: "nemo", label: "Nemo Beach" },
  { match: "radhanagar", label: "Radhanagar" },
  { match: "elephant", label: "Elephant Beach" },
  { match: "vijay nagar", label: "Vijay Nagar" },
  { match: "kala pathar", label: "Kala Pathar" },
  { match: "bharatpur", label: "Bharatpur" },
  { match: "laxmanpur", label: "Laxmanpur" },
  { match: "sitapur", label: "Sitapur" },
];

// An area that's just the island's own name says nothing a spot chip could.
const ISLAND_WORDS = /,?\s*\b(port blair|sri vijaya puram|havelock|swaraj dweep|neil|shaheed dweep)\b/gi;

/** The spot chip an activity belongs under, or null when its area is blank
 *  or only names the island. */
function spotOf(a: Activity): string | null {
  if (!a.area) return null;
  const lower = a.area.toLowerCase();
  const known = KNOWN_SPOTS.find((s) => lower.includes(s.match));
  if (known) return known.label;

  const rest = a.area.replace(ISLAND_WORDS, "").replace(/^[\s,]+|[\s,]+$/g, "");
  if (!rest) return null;
  return rest.replace(/\b\w/g, (c) => c.toUpperCase());
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`h-9 shrink-0 rounded-full border px-3.5 text-[12.5px] font-semibold transition ${
        on ? "border-brand bg-brand text-white" : "border-line bg-surface text-muted"
      }`}
    >
      {children}
    </button>
  );
}

function ChipRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-bold tracking-wider text-muted uppercase">{label}</p>
      <div className="no-bar -mx-5 flex gap-2 overflow-x-auto px-5 pb-1 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0">
        {children}
      </div>
    </div>
  );
}

/** The soonest slot a traveller could actually take — open and not sold out. */
function nextOpenSlot(a: Activity) {
  return a.slots.find((s) => s.isOpen && seatsLeft(s) > 0) ?? null;
}

export default function ActivityList({ activities }: { activities: Activity[] }) {
  const { island, setIslandId } = useIsland();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [spot, setSpot] = useState<string>("all");

  const ofType = (a: Activity) => filter === "all" || a.category === filter;
  const atSpot = (a: Activity) => spot === "all" || spotOf(a) === spot;
  const shown = activities.filter((a) => ofType(a) && atSpot(a));

  // Spots in the order of how much there is to do at each, busiest first.
  const spotCounts = new Map<string, number>();
  for (const a of activities) {
    const s = spotOf(a);
    if (s) spotCounts.set(s, (spotCounts.get(s) ?? 0) + 1);
  }
  const spots = [...spotCounts.entries()].sort((x, y) => y[1] - x[1]).map(([s]) => s);

  const filtered = filter !== "all" || spot !== "all";

  return (
    <>
      <div className="flex flex-col gap-3.5">
        {/* On lg the island switch is already in the desktop navbar. */}
        <div className="flex gap-2 lg:hidden">
          {ISLANDS.map((i) => {
            const on = i.id === island.id;
            return (
              <button
                key={i.id}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  if (on) return;
                  setSpot("all");
                  setIslandId(i.id);
                }}
                className={`flex min-h-10 flex-auto items-center justify-center rounded-xl border px-1.5 py-1.5 text-center text-[12px] leading-tight font-semibold ${
                  on ? "border-brand bg-brand text-white" : "border-line bg-surface text-muted"
                }`}
              >
                {i.name}
              </button>
            );
          })}
        </div>

        {spots.length > 1 && (
          <ChipRow label="Where">
            <Chip on={spot === "all"} onClick={() => setSpot("all")}>
              Anywhere
            </Chip>
            {spots.map((s) => {
              const count = activities.filter((a) => ofType(a) && spotOf(a) === s).length;
              if (count === 0 && s !== spot) return null;
              return (
                <Chip key={s} on={s === spot} onClick={() => setSpot(s)}>
                  {s} <span className="opacity-70">· {count}</span>
                </Chip>
              );
            })}
          </ChipRow>
        )}

        <ChipRow label="What">
          {FILTERS.map((f) => {
            const count = activities.filter(
              (a) => atSpot(a) && (f.id === "all" || a.category === f.id),
            ).length;
            if (count === 0 && f.id !== "all" && f.id !== filter) return null;
            return (
              <Chip key={f.id} on={f.id === filter} onClick={() => setFilter(f.id)}>
                {f.label}
                {f.id !== "all" && <span className="opacity-70"> · {count}</span>}
              </Chip>
            );
          })}
        </ChipRow>

        {filtered && (
          <div className="flex items-center justify-between text-[12.5px] font-semibold">
            <span className="text-muted">
              {shown.length} {shown.length === 1 ? "activity" : "activities"}
            </span>
            <button
              type="button"
              onClick={() => {
                setFilter("all");
                setSpot("all");
              }}
              className="text-brand"
            >
              Clear filters
            </button>
          </div>
        )}
      </div>

      <ul className="mt-4 flex flex-col gap-4 tablet:grid tablet:grid-cols-2 tablet:gap-4 lg:mt-6 lg:grid lg:grid-cols-3 lg:gap-5">
        {shown.map((a) => {
          const slot = nextOpenSlot(a);
          const left = slot ? seatsLeft(slot) : 0;
          return (
            <li key={a.slug}>
              <Link
                href={`/activities/${a.slug}`}
                className="card-hover block overflow-hidden rounded-panel border border-line bg-surface transition active:scale-[0.985] lg:flex lg:h-full lg:flex-col lg:active:scale-100"
              >
                <div className="relative h-40 w-full lg:h-48 lg:shrink-0">
                  {a.photos.length > 0 ? (
                    <Image
                      src={a.photos[0]}
                      alt=""
                      fill
                      sizes="(min-width: 1024px) 380px, (min-width: 768px) 400px, 100vw"
                      loading="lazy"
                      className="object-cover"
                    />
                  ) : (
                    <div className="font-display flex h-40 w-full items-center lg:h-48 justify-center bg-brandsoft text-[38px] font-bold text-brand">
                      {a.mark}
                    </div>
                  )}
                  <span className="absolute top-3 left-3 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-bold text-brand">
                    {CATEGORY_LABEL[a.category]}
                  </span>
                  <span className="absolute right-3 bottom-3 rounded-full bg-white/95 px-3 py-1.5 text-[14px] font-bold text-brand shadow-sm">
                    {rupees(a.pricePaise)}
                    <span className="text-[10.5px] font-semibold text-muted"> / person</span>
                  </span>
                </div>

                <div className="p-4 lg:flex lg:flex-1 lg:flex-col lg:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-[16px] leading-tight font-bold">{a.name}</p>
                    <Rating
                      rating={a.rating}
                      reviews={a.reviews}
                      size={14}
                      className="shrink-0 pt-0.5"
                    />
                  </div>
                  <p className="mt-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-brand">
                    <ShieldIcon size={14} className="shrink-0" />
                    {a.operator}
                  </p>
                  {a.area && (
                    <p className="mt-1 flex items-center gap-1.5 text-[12px] font-semibold text-muted">
                      <PinIcon size={13} className="shrink-0" />
                      {a.area}
                    </p>
                  )}
                  <p className="mt-1 line-clamp-2 text-[12px] font-medium text-muted">
                    {a.summary}
                  </p>

                  <div className="hidden lg:block lg:flex-1" aria-hidden />

                  <div className="mt-3 flex items-center justify-between border-t border-hairline pt-3 text-[12px] font-semibold">
                    <span className="flex items-center gap-1.5 text-muted">
                      <ClockIcon size={14} className="shrink-0" />
                      {slot ? `Next · ${slot.dayLabel} ${slot.timeLabel}` : "Times coming soon"}
                    </span>
                    {slot && left <= 3 && (
                      <span className="text-warn">{left} left</span>
                    )}
                  </div>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      {shown.length === 0 && (
        <p className="mt-10 text-center text-[13.5px] text-muted">
          Nothing matches those filters yet on this island.
        </p>
      )}
    </>
  );
}
