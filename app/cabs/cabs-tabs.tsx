"use client";

// The choice above both cab flows: book against the standardized rate card
// (dispatched by Andaman Go — one-way and same-day round trips both live
// there now), or hire an operator's own car for a full day at their own
// rate. CabSearch already renders a complete page — its own back button and
// header — so the full-day tab gets a slim neutral switch strip above it
// rather than a second stacked header; the rate-card tab gets the full brand
// header with the switch folded in.

import { useState } from "react";
import PageBack from "@/app/page-back";
import type { CabOperator, CabPlace } from "@/lib/cabs";
import type { CabRate } from "@/lib/cab-rate-card";
import CabSearch from "./cab-search";
import RateCardSearch from "./rate-card-search";

type Mode = "ratecard" | "marketplace";

export default function CabsTabs({
  islandSlug,
  operators,
  places,
  rates,
  commissionBps,
  initialPhone,
}: {
  islandSlug: string;
  operators: CabOperator[];
  places: CabPlace[];
  rates: CabRate[];
  commissionBps: number;
  initialPhone: string | null;
}) {
  const [mode, setMode] = useState<Mode>("ratecard");

  if (mode === "marketplace") {
    return (
      <>
        <div className="page-flow sticky top-0 z-30 bg-ground pt-[calc(var(--safe-top)+1rem)] pb-2">
          <div className="flex rounded-[14px] border border-line bg-surface p-1">
            <button
              type="button"
              onClick={() => setMode("ratecard")}
              className="h-10 flex-1 rounded-[10px] text-[12.5px] font-bold text-muted"
            >
              Book a ride
            </button>
            <button
              type="button"
              aria-pressed
              className="h-10 flex-1 rounded-[10px] bg-brand text-[12.5px] font-bold text-white"
            >
              Full day hire
            </button>
          </div>
        </div>
        <CabSearch operators={operators} />
      </>
    );
  }

  return (
    <>
      <div className="sticky top-0 z-30 bg-brand text-white">
        <div className="page-flow pt-[calc(var(--safe-top)+1.5rem)] pb-5 lg:pt-10 lg:pb-6">
          <div className="flex items-center gap-3">
            <PageBack href="/explore" />
            <h1 className="font-display text-[19px] lg:text-page font-bold tracking-tight">Cab / car</h1>
          </div>

          <div className="mt-4 flex rounded-[14px] bg-white/10 p-1">
            <button
              type="button"
              aria-pressed
              className="h-10 flex-1 rounded-[10px] bg-white text-[12.5px] font-bold text-brand"
            >
              Book a ride
            </button>
            <button
              type="button"
              onClick={() => setMode("marketplace")}
              className="h-10 flex-1 rounded-[10px] text-[12.5px] font-bold text-white/85"
            >
              Full day hire
            </button>
          </div>
        </div>
      </div>

      <RateCardSearch
        islandSlug={islandSlug}
        places={places}
        rates={rates}
        commissionBps={commissionBps}
        initialPhone={initialPhone}
      />
    </>
  );
}
