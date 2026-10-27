"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import BottomNav from "@/app/bottom-nav";
import PageBack from "@/app/page-back";
import {
  BedIcon,
  CloseIcon,
  DiveIcon,
  PinIcon,
  SearchIcon,
} from "@/app/icons";
import Rating from "@/app/rating";

export type SearchKind = "activity" | "stay" | "trip";

export type SearchItem = {
  id: string;
  kind: SearchKind;
  mark: string;
  title: string;
  sub: string;
  rating: string;
  reviews: number;
  priceLabel: string;
  href: string;
  /** Lowercased, pre-joined text this item matches against. */
  haystack: string;
};

const KIND_LABEL: Record<SearchKind, string> = {
  activity: "Activity",
  stay: "Stay",
  trip: "Adventure",
};

const KIND_ICON: Record<SearchKind, typeof DiveIcon> = {
  activity: DiveIcon,
  stay: BedIcon,
  trip: PinIcon,
};

const FILTERS: { id: "all" | SearchKind; label: string }[] = [
  { id: "all", label: "All" },
  { id: "activity", label: "Activities" },
  { id: "stay", label: "Stays" },
  { id: "trip", label: "Adventures" },
];

export default function SearchView({ items }: { items: SearchItem[] }) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | SearchKind>("all");

  const q = query.trim().toLowerCase();

  const results = useMemo(() => {
    const scoped = kind === "all" ? items : items.filter((i) => i.kind === kind);
    if (!q) return scoped;

    return scoped
      .filter((i) => i.haystack.includes(q))
      .sort((a, b) => Number(b.haystack.startsWith(q)) - Number(a.haystack.startsWith(q)));
  }, [items, kind, q]);

  return (
    <>
      <div className="sticky top-0 z-30 border-b border-hairline bg-surface">
        <div className="page-well flex items-center gap-3 pt-[calc(var(--safe-top)+1.5rem)] pb-4 lg:pt-10 lg:pb-6">
          <PageBack href="/explore" />
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-[19px] lg:text-page font-bold tracking-tight">Search</h1>
            <p className="text-[12px] font-medium text-muted">
              Activities, stays and island adventures
            </p>
          </div>
        </div>

        <div className="page-well pb-4">
          <div className="flex h-12 items-center gap-2.5 rounded-2xl border border-line bg-ground px-4">
            <SearchIcon size={18} className="shrink-0 text-muted" />
            <input
              autoFocus
              type="text"
              inputMode="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name"
              className="min-w-0 flex-1 bg-transparent text-[14px] font-medium text-ink placeholder:text-muted focus:outline-none"
            />
            {query && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setQuery("")}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-line text-muted"
              >
                <CloseIcon size={12} />
              </button>
            )}
          </div>

          <div className="no-bar -mx-5 mt-3 flex gap-2 overflow-x-auto px-5 pb-0.5 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0">
            {FILTERS.map((f) => {
              const on = f.id === kind;
              return (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setKind(f.id)}
                  className={`h-10 shrink-0 rounded-full border px-3.5 text-[12.5px] font-semibold ${
                    on ? "border-brand bg-brand text-white" : "border-line bg-surface text-muted"
                  }`}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <main className="page-well pt-4 pb-32 lg:pt-8 lg:pb-24">
        {!q ? (
          <p className="mt-10 text-center text-[13.5px] leading-relaxed text-muted">
            Start typing a name — a dive shop, a homestay, a trip host.
          </p>
        ) : results.length === 0 ? (
          <p className="mt-10 text-center text-[13.5px] leading-relaxed text-muted">
            No matches for &ldquo;{query}&rdquo;. Try a different name.
          </p>
        ) : (
          <>
            <p className="text-[12px] font-semibold text-muted">
              {results.length} {results.length === 1 ? "result" : "results"}
            </p>
            <ul className="mt-2.5 flex flex-col gap-3 tablet:grid tablet:grid-cols-2 tablet:gap-4 lg:grid lg:grid-cols-3 lg:gap-5">
              {results.map((item) => {
                const Icon = KIND_ICON[item.kind];
                return (
                  <li key={`${item.kind}-${item.id}`}>
                    <Link
                      href={item.href}
                      className="card-hover block rounded-card border border-line bg-surface p-3.5 transition active:scale-[0.985] lg:h-full lg:p-4 lg:active:scale-100"
                    >
                      <div className="flex gap-3.5">
                        <span className="font-display flex h-[58px] w-[58px] shrink-0 items-center justify-center rounded-[15px] bg-brandsoft text-lg font-bold text-brand">
                          {item.mark}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-1.5 text-[11px] font-bold tracking-wider text-brand uppercase">
                            <Icon size={12} />
                            {KIND_LABEL[item.kind]}
                          </p>
                          <p className="mt-0.5 text-[15px] leading-tight font-bold">
                            {item.title}
                          </p>
                          <p className="mt-1 text-[12px] font-medium text-muted">{item.sub}</p>
                        </div>
                      </div>

                      <div className="mt-3 flex items-center justify-between border-t border-hairline pt-3">
                        <Rating rating={item.rating} reviews={item.reviews} size={14} />
                        <span className="text-[13.5px] font-bold text-brand">
                          {item.priceLabel}
                        </span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </main>

      <BottomNav />
    </>
  );
}
