// Matches the Cab / car screen: a destination-style row list under the
// standard white header, while the rate card and operators load.

import BottomNav from "@/app/bottom-nav";

const bar = "block rounded bg-line";

function RowSkeleton() {
  return (
    <li className="flex items-center gap-3 rounded-[18px] border border-line bg-surface p-4">
      <span className="h-11 w-11 shrink-0 rounded-full bg-line" />
      <div className="min-w-0 flex-1">
        <span className={`${bar} h-3.5 w-2/3`} />
        <span className={`${bar} mt-2 h-3 w-1/3`} />
      </div>
      <span className={`${bar} h-4 w-14`} />
    </li>
  );
}

export default function Loading() {
  return (
    <>
      <div className="sticky top-0 z-30 border-b border-hairline bg-surface">
        <div className="page-flow pt-[calc(var(--safe-top)+1.5rem)] pb-3.5">
          <div className="flex items-center gap-3">
            <span className="-ml-2.5 h-11 w-11" />
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-[19px] font-bold tracking-tight">Cab / car</h1>
              <span className={`${bar} mt-1 h-3 w-40 animate-pulse`} />
            </div>
          </div>
        </div>
      </div>

      <main className="page-flow animate-pulse pt-4 pb-40">
        <div className="flex rounded-[14px] border border-line bg-surface p-1">
          <span className="h-10 flex-1 rounded-[10px] bg-line" />
          <span className="h-10 flex-1 rounded-[10px]" />
        </div>

        <ul className="mt-4 flex flex-col gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <RowSkeleton key={i} />
          ))}
        </ul>
      </main>

      <BottomNav />
    </>
  );
}
