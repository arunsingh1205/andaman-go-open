import type { Metadata } from "next";
import PageBack from "@/app/page-back";
import { getDays, getEvents } from "@/lib/events";
import { currentIslandSlug } from "@/lib/current-island";
import { TicketIcon } from "@/app/icons";
import BottomNav from "@/app/bottom-nav";
import SelectedIsland from "@/app/selected-island";
import EventList from "./event-list";

// Reads Supabase fresh on every request — see lib/supabase.ts — so this
// route can't be pre-generated.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Events, DJ nights & live music in Havelock and Port Blair — Andaman Go",
  description:
    "What's on in the Andaman Islands this week — DJ nights, live music, bonfires and karaoke. See the line-up and entry price, pay online, and your spot is confirmed instantly.",
  alternates: { canonical: "/events" },
};

export default async function EventsPage() {
  const islandSlug = await currentIslandSlug();
  const [events, days] = await Promise.all([getEvents(islandSlug), getDays(islandSlug)]);

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-hairline bg-surface">
        <div className="page-well pt-[calc(var(--safe-top)+1.5rem)] pb-3.5 lg:pt-10 lg:pb-6">
          <div className="flex items-center gap-3">
            <PageBack href="/explore" />
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-[19px] lg:text-page font-bold tracking-tight">
                Events &amp; DJ
              </h1>
              <p className="text-[12px] font-medium text-muted">
                <SelectedIsland suffix={`${events.length} on this week`} />
              </p>
            </div>
          </div>
          <p className="mt-2.5 flex items-center gap-1.5 text-[11.5px] font-semibold text-brand">
            <TicketIcon size={13} className="shrink-0" />
            Pay online — your spot&apos;s confirmed instantly
          </p>
        </div>
      </header>

      <main className="page-well pt-4 pb-32 lg:pt-8 lg:pb-24">
        <EventList events={events} days={days} />
      </main>

      <BottomNav />
    </>
  );
}
