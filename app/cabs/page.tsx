import type { Metadata } from "next";
import { getCabCommissionBps, getCabOperators, getCabPlaces } from "@/lib/cabs";
import { getCabRateCard } from "@/lib/cab-rate-card";
import { currentIslandSlug } from "@/lib/current-island";
import { getMyPhone } from "@/lib/profile";
import CabsTabs from "./cabs-tabs";

// Fares and availability come from Supabase fresh on every request — see
// lib/supabase.ts — so this route can't be pre-generated.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Cab & taxi booking in Port Blair, Havelock and Neil — Andaman Go",
  description:
    "Airport pickups, jetty transfers and day hires across the Andaman Islands, with the fare shown before you book. Local drivers, pay online, QR ticket on your phone.",
  alternates: { canonical: "/cabs" },
};

export default async function CabsPage() {
  const islandSlug = await currentIslandSlug();
  const [operators, places, commissionBps, rates, initialPhone] = await Promise.all([
    getCabOperators(islandSlug),
    getCabPlaces(),
    getCabCommissionBps(),
    getCabRateCard(islandSlug),
    getMyPhone(),
  ]);

  return (
    <CabsTabs
      islandSlug={islandSlug}
      operators={operators}
      places={places}
      rates={rates}
      commissionBps={commissionBps}
      initialPhone={initialPhone}
    />
  );
}
