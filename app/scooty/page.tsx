import type { Metadata } from "next";
import PageBack from "@/app/page-back";
import { getShops } from "@/lib/rentals";
import { currentIslandSlug } from "@/lib/current-island";
import BottomNav from "@/app/bottom-nav";
import SelectedIsland from "@/app/selected-island";
import ShopList from "./shop-list";

// Reads Supabase fresh on every request — see lib/supabase.ts.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Scooty & bike rental in Havelock, Port Blair and Neil — Andaman Go",
  description:
    "Rent a scooter, bike or cycle by the day from verified shops in Havelock (Swaraj Dweep), Port Blair and Neil. Real stock counts, daily rates up front, book online.",
  alternates: { canonical: "/scooty" },
};

export default async function RentalsPage() {
  const shops = await getShops(await currentIslandSlug());

  return (
    <>
      <div className="sticky top-0 z-30 border-b border-hairline bg-surface">
        <div className="page-well flex items-center gap-3 pt-[calc(var(--safe-top)+1.5rem)] pb-4 lg:pt-10 lg:pb-6">
          <PageBack href="/explore" />
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-[19px] lg:text-page font-bold tracking-tight">Rentals</h1>
            <p className="text-[12px] font-medium text-muted">
              <SelectedIsland suffix="scooters, bikes and cycles" />
            </p>
          </div>
          <span className="rounded-full bg-brandsoft px-2.5 py-1.5 text-[11px] font-bold text-brand">
            {shops.length} shops
          </span>
        </div>
      </div>

      <main className="page-well pt-4 pb-32 lg:pt-8 lg:pb-24">
        <ShopList shops={shops} />
      </main>

      <BottomNav />
    </>
  );
}