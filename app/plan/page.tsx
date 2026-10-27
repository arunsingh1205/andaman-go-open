import PageBack from "@/app/page-back";
import { clampGuests, DEFAULT_GUESTS, getPlannableInventory, planDay } from "@/lib/day-plan";
import { currentIslandSlug } from "@/lib/current-island";
import { ISLANDS, islandLabel } from "@/lib/islands";
import TripStrip from "@/app/trip-strip";
import PlanDay from "./plan-day";

// The plannable catalogue reads Supabase fresh — seats and tables move.
export const dynamic = "force-dynamic";

export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<{ guests?: string; island?: string; day?: string }>;
}) {
  const { guests: guestsParam, island: islandParam, day: dayParam } = await searchParams;

  const islandSlug =
    islandParam && ISLANDS.some((i) => i.slug === islandParam)
      ? islandParam
      : await currentIslandSlug();
  const guests = clampGuests(Number(guestsParam) || DEFAULT_GUESTS);
  const { key: dayKey, label: dayLabel } = planDay(dayParam);

  const inventory = await getPlannableInventory(islandSlug, dayKey);

  return (
    <>
      <div className="sticky top-0 z-30 border-b border-hairline bg-surface">
        <div className="page-flow flex items-center gap-3 pt-[calc(var(--safe-top)+1.5rem)] pb-4 lg:pt-10 lg:pb-6">
          <PageBack href="/explore" />
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-[19px] lg:text-page font-bold tracking-tight">
              Plan my day
            </h1>
            <p className="text-[12px] font-medium text-muted">
              {islandLabel(islandSlug)} · {dayLabel} · {guests}{" "}
              {guests === 1 ? "guest" : "guests"}
            </p>
          </div>
        </div>
      </div>

      <PlanDay
        inventory={inventory}
        islandSlug={islandSlug}
        islandName={islandLabel(islandSlug)}
        guests={guests}
        dayKey={dayKey}
        dayLabel={dayLabel}
      />

      <div className="page-flow pb-36">
        <TripStrip />
      </div>
    </>
  );
}
