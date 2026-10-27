import type { Metadata } from "next";
import PageBack from "@/app/page-back";
import { getCommunityServices } from "@/lib/community";
import { currentIslandSlug } from "@/lib/current-island";
import { HandsIcon } from "@/app/icons";
import BottomNav from "@/app/bottom-nav";
import SelectedIsland from "@/app/selected-island";
import CommunityList from "./community-list";

// One-off dated listings read fresh from Supabase on every request — see
// lib/supabase.ts — so this route can't be pre-generated.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Beach cleanups & volunteer days in the Andaman Islands — Andaman Go",
  description:
    "Free community activities in Havelock, Port Blair and Neil — beach cleanups, drives and volunteer days run by local communities and NGOs. Join one while you're on the islands.",
  alternates: { canonical: "/community" },
};

export default async function CommunityPage() {
  const services = await getCommunityServices(await currentIslandSlug());

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-hairline bg-surface">
        <div className="page-well pt-[calc(var(--safe-top)+1.5rem)] pb-3.5 lg:pt-10 lg:pb-6">
          <div className="flex items-center gap-3">
            <PageBack href="/explore" />
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-[19px] lg:text-page font-bold tracking-tight">Community service</h1>
              <p className="text-[12px] font-medium text-muted">
                <SelectedIsland suffix={`${services.length} coming up`} />
              </p>
            </div>
          </div>
          <p className="mt-2.5 flex items-center gap-1.5 text-[11.5px] font-semibold text-brand">
            <HandsIcon size={13} className="shrink-0" />
            Free to join — run by local communities & NGOs
          </p>
        </div>
      </header>

      <main className="page-well pt-4 pb-32 lg:pt-8 lg:pb-24">
        <CommunityList services={services} />
      </main>

      <BottomNav />
    </>
  );
}
