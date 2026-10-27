import Link from "next/link";
import PageBack from "@/app/page-back";
import { getStays, nightsBetween } from "@/lib/stays";
import { ISLANDS } from "@/lib/islands";
import { fmtDayNum, fmtMonth } from "@/lib/date";
import { SearchIcon } from "@/app/icons";
import BottomNav from "@/app/bottom-nav";
import StayList from "../stay-list";

// Reads Supabase fresh on every request — see lib/supabase.ts.
export const dynamic = "force-dynamic";

function dateLabel(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  return `${fmtDayNum(d)} ${fmtMonth(d)}`;
}

export default async function StaysResultsPage({
  searchParams,
}: {
  searchParams: Promise<{ island?: string; checkin?: string; checkout?: string; guests?: string }>;
}) {
  const params = await searchParams;
  const island = params.island?.trim() || undefined;
  const stays = await getStays(island);
  const islandFull = island ? ISLANDS.find((i) => i.slug === island)?.full : undefined;

  // Carried through to every result's detail-page link so the booking panel
  // opens pre-filled with what was already searched, instead of asking again.
  const q = new URLSearchParams();
  if (params.island) q.set("island", params.island);
  if (params.checkin) q.set("checkin", params.checkin);
  if (params.checkout) q.set("checkout", params.checkout);
  if (params.guests) q.set("guests", params.guests);
  const searchQuery = q.toString() ? `?${q.toString()}` : "";

  // The same "destination · dates · guests" summary line most booking
  // platforms show right under the destination, tappable to go back and
  // change it — the search step (app/stays/page.tsx) reads these same
  // params back out to re-open pre-filled.
  const nights =
    params.checkin && params.checkout ? nightsBetween(params.checkin, params.checkout) : null;
  const guests = params.guests ? Number(params.guests) : null;
  const summaryParts = [
    params.checkin && params.checkout
      ? `${dateLabel(params.checkin)} – ${dateLabel(params.checkout)}`
      : null,
    nights ? `${nights} ${nights === 1 ? "night" : "nights"}` : null,
    guests ? `${guests} ${guests === 1 ? "guest" : "guests"}` : null,
  ].filter(Boolean);

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-hairline bg-surface">
        <div className="page-well pt-[calc(var(--safe-top)+1.5rem)] pb-3.5 lg:pt-10 lg:pb-6">
          <div className="flex items-center gap-3">
            <PageBack href="/stays" label="Back to search" className="shrink-0" />
            <Link href={`/stays${searchQuery}`} className="min-w-0 flex-1">
              <h1 className="truncate font-display text-[19px] lg:text-page font-bold tracking-tight">
                {islandFull ?? "All islands"}
              </h1>
              <p className="truncate text-[12px] font-medium text-muted">
                {summaryParts.length > 0
                  ? summaryParts.join(" · ")
                  : `${stays.length} stay${stays.length === 1 ? "" : "s"}`}
              </p>
            </Link>
            <Link
              href={`/stays${searchQuery}`}
              aria-label="Edit search"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line text-brand"
            >
              <SearchIcon size={17} />
            </Link>
          </div>
        </div>
      </header>

      <main className="page-well pt-4 pb-32 lg:pt-8 lg:pb-24">
        <StayList stays={stays} searchQuery={searchQuery} />
      </main>

      <BottomNav />
    </>
  );
}
