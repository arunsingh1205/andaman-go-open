import type { Metadata } from "next";
import { getActivities } from "@/lib/activities";
import { currentIslandSlug } from "@/lib/current-island";
import { ShieldIcon } from "@/app/icons";
import PageBack from "@/app/page-back";
import BottomNav from "@/app/bottom-nav";
import SelectedIsland from "@/app/selected-island";
import ActivityList from "./activity-list";

// Seat counts come from Supabase on every read (see lib/supabase.ts) — a
// cached or statically-built page would show stale seats, so this route
// renders fresh on every request rather than being pre-generated.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Scuba diving, snorkelling & sea walk in Havelock and Port Blair — Andaman Go",
  description:
    "Book scuba dives, snorkelling, sea walks and water sports in Havelock (Swaraj Dweep), Port Blair and Neil directly with licence-checked operators. Live slots, pay online, QR ticket.",
  alternates: { canonical: "/activities" },
};

export default async function ActivitiesPage() {
  const activities = await getActivities(await currentIslandSlug());

  return (
    <>
      {/* Same white bar the other category screens use. The old "4 licence-
          checked" chip read as a stock count; the count moves into the
          subtitle and the trust line below says the real thing in words. */}
      <header className="sticky top-0 z-30 border-b border-hairline bg-surface">
        <div className="page-well pt-[calc(var(--safe-top)+1.5rem)] pb-3.5 lg:pt-10 lg:pb-6">
          <div className="flex items-center gap-3">
            <PageBack href="/explore" />
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-[19px] lg:text-page font-bold tracking-tight">Activities</h1>
              <p className="text-[12px] font-medium text-muted">
                <SelectedIsland suffix={`${activities.length} to book`} />
              </p>
            </div>
          </div>
          <p className="mt-2.5 flex items-center gap-1.5 text-[11.5px] font-semibold text-brand">
            <ShieldIcon size={13} className="shrink-0" />
            Every operator here is licence-checked
          </p>
        </div>
      </header>

      <main className="page-well pt-4 pb-32 lg:pt-8 lg:pb-24">
        <ActivityList activities={activities} />
      </main>

      <BottomNav />
    </>
  );
}
