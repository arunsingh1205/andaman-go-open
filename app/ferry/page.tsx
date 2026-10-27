import type { Metadata } from "next";
import { getDays, getSailings, FERRY_BOOKING_ENABLED } from "@/lib/ferries";
import FerrySearch from "./ferry-search";
import FerryPaused from "./ferry-paused";

// Fares and seats come from Supabase fresh on every request — see
// lib/supabase.ts — so this route can't be pre-generated.
export const dynamic = "force-dynamic";

// The snippet only promises online booking while it is actually switched on.
export const metadata: Metadata = {
  title: "Port Blair – Havelock – Neil ferry tickets & timings — Andaman Go",
  description: FERRY_BOOKING_ENABLED
    ? "Every ferry sailing between Port Blair, Havelock (Swaraj Dweep) and Neil (Shaheed Dweep) in one list — times, durations and fares for your group. Pick a departure and book seats online."
    : "Ferries between Port Blair, Havelock (Swaraj Dweep) and Neil (Shaheed Dweep). Online booking is paused for now — message us and a person checks seats with the operators for you.",
  alternates: { canonical: "/ferry" },
};

export default async function FerryPage() {
  if (!FERRY_BOOKING_ENABLED) return <FerryPaused />;

  const [sailings, days] = await Promise.all([getSailings(), getDays()]);

  return <FerrySearch sailings={sailings} days={days} />;
}