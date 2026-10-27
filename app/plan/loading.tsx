// Matches the Plan a day screen: back header, then the Activities/Events/
// Rides sections while the day's plannable inventory loads.

import BottomNav from "@/app/bottom-nav";

const bar = "block rounded bg-line";

function SectionSkeleton() {
  return (
    <div className="mt-6">
      <span className={`${bar} h-3 w-28`} />
      <div className="mt-2.5 flex flex-col gap-2.5">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-[18px] border border-line bg-surface p-3.5">
            <span className="h-11 w-11 shrink-0 rounded-[13px] bg-line" />
            <div className="min-w-0 flex-1">
              <span className={`${bar} h-3.5 w-2/3`} />
              <span className={`${bar} mt-2 h-3 w-1/3`} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Loading() {
  return (
    <>
      <div className="sticky top-0 z-30 border-b border-hairline bg-surface">
        <div className="page-flow flex items-center gap-3 pt-[calc(var(--safe-top)+1.5rem)] pb-4">
          <span className="-ml-2.5 h-11 w-11" />
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-[19px] font-bold tracking-tight">Plan a day</h1>
            <span className={`${bar} mt-1 h-3 w-40 animate-pulse`} />
          </div>
        </div>
      </div>

      <main className="page-flow animate-pulse pt-4 pb-40">
        <SectionSkeleton />
        <SectionSkeleton />
        <SectionSkeleton />
      </main>

      <BottomNav />
    </>
  );
}
