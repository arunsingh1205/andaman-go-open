// Matches the Search screen: back header + search bar + filter pills, while
// activities/stays/trips load to build the searchable list.

import BottomNav from "@/app/bottom-nav";

const bar = "block rounded bg-line";

function RowSkeleton() {
  return (
    <li className="flex items-center gap-3.5 rounded-[18px] border border-line bg-surface p-3.5">
      <span className="h-[52px] w-[52px] shrink-0 rounded-2xl bg-line" />
      <div className="min-w-0 flex-1">
        <span className={`${bar} h-3.5 w-2/3`} />
        <span className={`${bar} mt-2 h-3 w-1/3`} />
      </div>
      <span className={`${bar} h-3.5 w-14`} />
    </li>
  );
}

export default function Loading() {
  return (
    <>
      <div className="sticky top-0 z-30 border-b border-hairline bg-surface">
        <div className="page-well flex items-center gap-3 pt-[calc(var(--safe-top)+1.5rem)] pb-4">
          <span className="-ml-2.5 h-11 w-11" />
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-[19px] font-bold tracking-tight">Search</h1>
            <p className="text-[12px] font-medium text-muted">
              Activities, stays and island adventures
            </p>
          </div>
        </div>

        <div className="page-well animate-pulse pb-4">
          <div className="h-12 rounded-2xl bg-line" />
          <div className="mt-3 flex gap-2">
            {[44, 76, 64, 84].map((w, i) => (
              <span key={i} className="h-8 rounded-full bg-line" style={{ width: w }} />
            ))}
          </div>
        </div>
      </div>

      <main className="page-well animate-pulse pt-4 pb-32 lg:pt-8 lg:pb-24">
        <ul className="flex flex-col gap-3 tablet:grid tablet:grid-cols-2 tablet:gap-4 lg:grid lg:grid-cols-3 lg:gap-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <RowSkeleton key={i} />
          ))}
        </ul>
      </main>

      <BottomNav />
    </>
  );
}
