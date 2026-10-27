// Matches the Home screen: brand header, search bar, island picker, the
// 8-tile category grid, plan banner, then the Trips and Popular strips —
// while getShops() (and the price teaser it feeds) reads Supabase.

import BottomNav from "@/app/bottom-nav";

const bar = "block rounded bg-line";

function TileSkeleton() {
  return (
    <div className="flex h-[108px] flex-col justify-between rounded-card border border-line bg-surface p-3.5 lg:h-[148px] lg:p-5">
      <span className="h-[26px] w-[26px] rounded bg-line" />
      <div>
        <span className={`${bar} h-3.5 w-3/4`} />
        <span className={`${bar} mt-1.5 h-2.5 w-1/2`} />
      </div>
    </div>
  );
}

function StripCardSkeleton({ width, photoHeight }: { width: number; photoHeight: number }) {
  return (
    <div
      className="shrink-0 overflow-hidden rounded-[18px] border border-line bg-surface"
      style={{ width }}
    >
      <span className="block w-full bg-line" style={{ height: photoHeight }} />
      <div className="p-3">
        <span className={`${bar} h-3 w-2/3`} />
        <span className={`${bar} mt-1.5 h-2.5 w-1/2`} />
      </div>
    </div>
  );
}

export default function Loading() {
  return (
    <>
      <main className="page-well animate-pulse pt-[calc(var(--safe-top)+1.5rem)] pb-32 lg:pt-12 lg:pb-24">
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3 lg:hidden">
          <span className="h-[18px] w-32 rounded bg-line" />
          <span className="h-10 w-10 shrink-0 rounded-xl bg-line" />
        </div>

        <div className="mt-4.5 h-12 rounded-2xl bg-line lg:hidden" />

        <div className="mt-4.5 flex gap-2 lg:hidden">
          {[0, 1, 2].map((i) => (
            <span key={i} className="h-11 flex-1 rounded-xl bg-line" />
          ))}
        </div>
        <div className="mt-3 h-16 rounded-card bg-line lg:mt-0 lg:h-[132px] lg:w-2/3" />

        <div className="mt-4.5 grid grid-cols-2 gap-3 lg:mt-12 lg:grid-cols-4 lg:gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <TileSkeleton key={i} />
          ))}
        </div>

        <div className="mt-4.5 h-16 rounded-2xl bg-line lg:hidden" />

        <div className="mt-7">
          <span className={`${bar} h-3 w-32`} />
          <div className="no-bar -mx-5 mt-3 flex gap-3 overflow-x-auto px-5 pb-1">
            {Array.from({ length: 3 }).map((_, i) => (
              <StripCardSkeleton key={i} width={248} photoHeight={112} />
            ))}
          </div>
        </div>

        <div className="mt-7">
          <span className={`${bar} h-3 w-40`} />
          <div className="no-bar -mx-5 mt-3 flex gap-3 overflow-x-auto px-5 pb-1">
            {Array.from({ length: 3 }).map((_, i) => (
              <StripCardSkeleton key={i} width={190} photoHeight={128} />
            ))}
          </div>
        </div>
      </main>

      <BottomNav />
    </>
  );
}
