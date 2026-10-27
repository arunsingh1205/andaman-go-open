"use client";

import { useMemo, useState } from "react";
import PageBack from "@/app/page-back";
import Image from "next/image";
import {
  fmtDuration,
  fmtTime,
  routesOf,
  type DayChip,
  type Sailing,
} from "@/lib/ferries";
import { BOOKING_CUTOFF_HOURS, instantIso, isPastCutoff } from "@/lib/date";
import { rupees } from "@/lib/activities";
import { useIsland } from "@/lib/island-context";
import { SwapIcon, ChevronIcon, CheckIcon } from "@/app/icons";
import PassengerForm from "./passenger-form";

const SORTS = [
  { id: "cheap", label: "Cheapest" },
  { id: "fast", label: "Fastest" },
  { id: "early", label: "Earliest" },
];

const MAX_ADULTS = 10;

// Belt-and-suspenders: every date this search offers is already at least 3
// days out (lib/ferries.ts getDays()), so BOOKING_CUTOFF_HOURS should never
// actually trip here — it only matters if that minimum ever changes.

export default function FerrySearch({
  sailings,
  days,
}: {
  sailings: Sailing[];
  days: DayChip[];
}) {
  const { island } = useIsland();

  const routes = useMemo(() => routesOf(sailings), [sailings]);
  const nameOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of routes) {
      m.set(r.fromSlug, r.fromName);
      m.set(r.toSlug, r.toName);
    }
    return m;
  }, [routes]);
  const fromSlugs = useMemo(
    () => [...new Set(routes.map((r) => r.fromSlug))],
    [routes],
  );
  const toSlugsFrom = (from: string) =>
    routes.filter((r) => r.fromSlug === from).map((r) => r.toSlug);

  // Start the search pointed the way someone standing on the current island
  // most likely wants to travel: leaving from here, heading to Havelock (where
  // most of the app's activity is) or else Port Blair (the airport). Fall back
  // to any route that exists.
  const start = useMemo(() => {
    const leavingFrom = (from: string) =>
      routes.find((r) => r.fromSlug === from && r.toSlug === "havelock") ??
      routes.find((r) => r.fromSlug === from && r.toSlug === "port-blair") ??
      routes.find((r) => r.fromSlug === from);
    return (
      leavingFrom(island.slug) ??
      leavingFrom("port-blair") ??
      routes[0] ?? { fromSlug: "", toSlug: "" }
    );
  }, [routes, island.slug]);

  const [fromSlug, setFromSlug] = useState(start.fromSlug);
  const [toSlug, setToSlug] = useState(start.toSlug);
  const [picking, setPicking] = useState<null | "from" | "to">(null);
  // Every date this search offers is already at least 3 days out (see
  // lib/ferries.ts getDays()), so the earliest one is a fine default.
  const [dayKey, setDayKey] = useState(days[0].key);
  const [sort, setSort] = useState("cheap");
  const [selected, setSelected] = useState<string | null>(null);
  const [adults, setAdults] = useState(2);
  const [step, setStep] = useState<"list" | "passengers">("list");

  const from = nameOf.get(fromSlug) ?? fromSlug;
  const to = nameOf.get(toSlug) ?? toSlug;

  const reverse = routes.find(
    (r) => r.fromSlug === toSlug && r.toSlug === fromSlug,
  );

  const pickFrom = (slug: string) => {
    setFromSlug(slug);
    const tos = toSlugsFrom(slug);
    if (!tos.includes(toSlug)) setToSlug(tos[0]);
    setSelected(null);
    setPicking(null);
  };
  const pickTo = (slug: string) => {
    setToSlug(slug);
    setSelected(null);
    setPicking(null);
  };
  const swap = () => {
    if (!reverse) return;
    setFromSlug(reverse.fromSlug);
    setToSlug(reverse.toSlug);
    setSelected(null);
    setPicking(null);
  };

  const onRoute = sailings.filter(
    (s) =>
      s.fromSlug === fromSlug &&
      s.toSlug === toSlug &&
      !isPastCutoff(instantIso(dayKey, s.depMins), BOOKING_CUTOFF_HOURS),
  );
  const ordered = [...onRoute].sort((a, b) => {
    if (sort === "cheap") return a.farePaise - b.farePaise;
    if (sort === "fast") return a.durationMins - b.durationMins;
    return a.depMins - b.depMins;
  });

  const chosen = onRoute.find((s) => s.id === selected) ?? null;
  const chosenDay = days.find((d) => d.key === dayKey) ?? days[0];

  if (step === "passengers" && chosen) {
    return (
      <PassengerForm
        sailing={chosen}
        from={from}
        to={to}
        day={chosenDay}
        dayKey={dayKey}
        count={adults}
        onBack={() => setStep("list")}
      />
    );
  }

  const tagClass = (tone: Sailing["tagTone"]) =>
    tone === "good"
      ? "bg-brandsoft text-brand"
      : tone === "warm"
        ? "bg-sandsoft text-sandink2"
        : "bg-ground text-muted";

  const menuSlugs = picking === "from" ? fromSlugs : toSlugsFrom(fromSlug);

  return (
    <>
      <div className="sticky top-0 z-30 bg-brand text-white">
        <div className="page-flow pt-[calc(var(--safe-top)+1.5rem)] pb-5 lg:pt-10 lg:pb-6">
          <div className="flex items-center gap-3">
            <PageBack href="/explore" />
            <h1 className="font-display text-[19px] lg:text-page font-bold tracking-tight">
              Book a ferry
            </h1>
          </div>

          <div className="relative mt-4">
            {picking && (
              <button
                type="button"
                aria-label="Close"
                onClick={() => setPicking(null)}
                className="fixed inset-0 z-10 cursor-default"
              />
            )}

            <div className="flex items-center gap-3 rounded-[18px] border border-white/15 bg-white/10 p-4">
              <button
                type="button"
                onClick={() => setPicking(picking === "from" ? null : "from")}
                className="min-w-0 flex-1 text-left"
              >
                <span className="block text-[10.5px] font-bold tracking-wider uppercase opacity-60">
                  From
                </span>
                {/* The name carries its own truncate rather than the row:
                    text-overflow only acts on a block's inline content, and as
                    a bare flex item the name would clip with no ellipsis. */}
                <span className="mt-0.5 flex items-center gap-1 text-[13px] font-bold">
                  <span className="truncate">{from}</span>
                  <ChevronIcon
                    size={14}
                    className={`shrink-0 opacity-70 transition ${picking === "from" ? "-rotate-90" : "rotate-90"}`}
                  />
                </span>
              </button>

              <button
                type="button"
                aria-label="Swap direction"
                disabled={!reverse}
                onClick={swap}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-brand disabled:opacity-40"
              >
                <SwapIcon size={19} />
              </button>

              <button
                type="button"
                onClick={() => setPicking(picking === "to" ? null : "to")}
                className="min-w-0 flex-1 text-right"
              >
                <span className="block text-[10.5px] font-bold tracking-wider uppercase opacity-60">
                  To
                </span>
                {/* Same as From, and this is the side the clipping showed on:
                    justify-end pushed the overflow off the left edge, eating
                    the leading letter of "Sri Vijaya Puram". */}
                <span className="mt-0.5 flex items-center justify-end gap-1 text-[13px] font-bold">
                  <span className="truncate">{to}</span>
                  <ChevronIcon
                    size={14}
                    className={`shrink-0 opacity-70 transition ${picking === "to" ? "-rotate-90" : "rotate-90"}`}
                  />
                </span>
              </button>
            </div>

            {picking && (
              <div
                className={`absolute top-full z-20 mt-2 w-[190px] rounded-2xl border border-line bg-surface p-1.5 shadow-xl ${
                  picking === "from" ? "left-0" : "right-0"
                }`}
              >
                {menuSlugs.map((slug) => {
                  const on =
                    picking === "from" ? slug === fromSlug : slug === toSlug;
                  return (
                    <button
                      key={slug}
                      type="button"
                      onClick={() =>
                        picking === "from" ? pickFrom(slug) : pickTo(slug)
                      }
                      className="flex w-full items-center justify-between rounded-xl px-3.5 py-3 text-left text-[14px] font-semibold text-ink"
                    >
                      {nameOf.get(slug) ?? slug}
                      {on && <CheckIcon size={16} className="text-brand" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Always a horizontal strip, never lg:flex-wrap: that suited the
              old 6-day window, but wrapping 31 days (getDays()) turns this
              into a wall of chips instead of a scrollable row. */}
          <div className="no-bar mt-3 flex gap-2 overflow-x-auto pb-0.5">
            {days.map((d) => {
              const on = d.key === dayKey;
              return (
                <button
                  key={d.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setDayKey(d.key)}
                  className={`h-11 shrink-0 rounded-xl border px-4 text-[13px] font-semibold ${
                    on
                      ? "border-white bg-white text-brand"
                      : "border-white/15 bg-white/10 text-white"
                  }`}
                >
                  {d.label} {d.num} {d.month}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="page-flow flex items-center gap-3 pt-4">
        <p className="flex-1 text-[12.5px] font-semibold text-muted">
          {ordered.length} {ordered.length === 1 ? "sailing" : "sailings"}
        </p>
        <div className="flex shrink-0 rounded-[13px] bg-ground p-1">
          {SORTS.map((s) => {
            const on = s.id === sort;
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={on}
                onClick={() => setSort(s.id)}
                className={`h-11 rounded-[10px] px-3 text-[12.5px] font-bold ${
                  on ? "bg-surface text-brand shadow-sm" : "text-muted"
                }`}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="page-flow mt-3">
        <div className="flex items-center justify-between rounded-2xl border border-line bg-surface px-4 py-2.5">
          <span className="text-[14px] font-semibold">Passengers</span>
          <div className="flex items-center gap-3.5">
            <button
              type="button"
              aria-label="Fewer passengers"
              disabled={adults <= 1}
              onClick={() => setAdults((a) => Math.max(1, a - 1))}
              className="h-10 w-10 rounded-xl border border-line bg-ground text-lg font-bold text-brand disabled:opacity-40"
            >
              −
            </button>
            <span className="w-5 text-center text-[16px] font-bold">{adults}</span>
            <button
              type="button"
              aria-label="More passengers"
              disabled={adults >= MAX_ADULTS}
              onClick={() => setAdults((a) => Math.min(MAX_ADULTS, a + 1))}
              className="h-10 w-10 rounded-xl bg-brand text-lg font-bold text-white disabled:opacity-40"
            >
              +
            </button>
          </div>
        </div>
      </div>

      <main className="page-flow pt-3.5 pb-36">
        {ordered.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-line bg-surface p-6 text-center">
            <p className="text-[14px] font-bold">No sailings on this route</p>
            <p className="mt-1.5 text-[12.5px] leading-relaxed font-medium text-muted">
              Nobody runs {from} → {to} through the app yet.
              {reverse && ` Try ${to} → ${from}, or another pair.`}
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {ordered.map((s) => {
              const on = s.id === selected;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => setSelected(s.id)}
                    className={`w-full rounded-[18px] border bg-surface p-4 text-left transition ${
                      on ? "border-brand shadow-md" : "border-line"
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      {s.photos.length > 0 && (
                        <span className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-[10px] border border-line bg-ground">
                          <Image
                            src={s.photos[0]}
                            alt=""
                            fill
                            sizes="32px"
                            loading="lazy"
                            className="object-cover"
                          />
                        </span>
                      )}
                      <span className="min-w-0 truncate text-[14.5px] font-bold">
                        {s.operator}
                      </span>
                      <span
                        className={`shrink-0 rounded-full px-2 py-1 text-[10.5px] font-bold ${tagClass(s.tagTone)}`}
                      >
                        {s.tag}
                      </span>
                    </div>

                    <div className="mt-3 flex items-center gap-3">
                      <div className="text-center">
                        <p className="text-[17px] font-bold tracking-tight">
                          {fmtTime(s.depMins)}
                        </p>
                        <p className="mt-0.5 text-[11px] font-semibold text-muted">
                          {from}
                        </p>
                      </div>

                      <div className="flex flex-1 flex-col items-center gap-1">
                        <p className="text-[10.5px] font-bold text-muted">
                          {fmtDuration(s.durationMins)}
                        </p>
                        <div className="h-px w-full bg-line" />
                      </div>

                      <div className="text-center">
                        <p className="text-[17px] font-bold tracking-tight">
                          {fmtTime(s.depMins + s.durationMins)}
                        </p>
                        <p className="mt-0.5 text-[11px] font-semibold text-muted">
                          {to}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-between border-t border-hairline pt-3">
                      <span
                        className={`text-[11.5px] font-semibold ${
                          s.noteWarn ? "text-warn" : "text-muted"
                        }`}
                      >
                        {s.note}
                      </span>
                      <span className="text-[17px] font-bold text-brand">
                        {rupees(s.farePaise)}
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-3.5 rounded-2xl border border-sandline bg-sandsoft p-3.5">
          <p className="text-[12.5px] leading-relaxed font-medium text-sandink2">
            Next you&apos;ll add each passenger by name and ID. We place the booking
            with the operator and send the e-ticket on WhatsApp — usually within a
            few hours. Carry the same photo ID to the jetty.
          </p>
        </div>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface">
        <div className="page-flow flex items-center gap-3.5 pt-3.5 pb-[max(1.5rem,calc(var(--safe-bottom)+0.5rem))]">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[11px] font-semibold text-muted">
              {chosen
                ? `${chosen.operator} · ${adults} ${adults === 1 ? "adult" : "adults"}`
                : "Pick a sailing to continue"}
            </p>
            <p className="mt-0.5 text-[19px] font-bold tracking-tight">
              {chosen ? rupees(chosen.farePaise * adults) : "—"}
            </p>
          </div>
          <button
            type="button"
            disabled={!chosen}
            onClick={() => setStep("passengers")}
            className={`flex h-13 shrink-0 items-center gap-2 rounded-2xl px-6 py-3.5 text-[15px] font-bold ${
              chosen ? "bg-brand text-white" : "bg-ground text-muted"
            }`}
          >
            Continue
            <ChevronIcon size={18} />
          </button>
        </div>
      </div>
    </>
  );
}
