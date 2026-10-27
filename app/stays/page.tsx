import type { Metadata } from "next";
import { Suspense } from "react";
import { BedIcon } from "@/app/icons";
import BottomNav from "@/app/bottom-nav";
import PageBack from "@/app/page-back";
import StaysSearch from "./stays-search";

// A server component whose only job is to be the <Suspense> boundary that
// stays-search.tsx's useSearchParams() needs — see the note there.
//
// The payoff for the boundary being here rather than nowhere: this shell is
// prerendered at build time and served as static HTML, so the teal header
// and the page's shape are on screen before any JavaScript has run. The
// search card swaps in when StaysSearch hydrates. Nothing on this screen
// depends on the request, so there is nothing to wait for a server about.
export const metadata: Metadata = {
  title: "Homestays, guesthouses & hotels in Havelock, Port Blair and Neil — Andaman Go",
  description:
    "Rooms and whole properties across the Andaman Islands, booked directly with the host. Search by island, dates and guests, see real nightly rates, and pay online.",
  alternates: { canonical: "/stays" },
};

export default function StaysPage() {
  return (
    <Suspense fallback={<StaysSearchShell />}>
      <StaysSearch />
    </Suspense>
  );
}

// The same header and card geometry StaysSearch renders, minus the inputs,
// so the swap at hydration is a fill rather than a jump — same teal block,
// same card, same height, no layout shift.
function StaysSearchShell() {
  return (
    <>
      <div className="sticky top-0 z-30 bg-brand text-white">
        <div className="page-flow pt-[calc(var(--safe-top)+1.5rem)] pb-5">
          <div className="flex items-center gap-3">
            <PageBack href="/explore" />
            <h1 className="font-display text-[19px] lg:text-page font-bold tracking-tight">
              Stays &amp; homestays
            </h1>
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-[12.5px] font-medium text-white/85">
            <BedIcon size={14} className="shrink-0" />
            Rooms and whole properties, booked directly with the host
          </p>
        </div>
      </div>

      {/* pt-4, not a negative margin up into the teal band: the band is sticky
          at z-30, so a card pulled up under it didn't overlap it — its top
          edge and rounded corners were simply hidden behind the band. */}
      <main className="page-flow pt-4 pb-32">
        <div
          aria-hidden
          className="h-[365px] rounded-[20px] border border-line bg-surface shadow-[0_6px_24px_rgba(11,36,34,0.08)]"
        />
      </main>

      <BottomNav />
    </>
  );
}
