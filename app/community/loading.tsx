// Matches the Community service screen: white header + text cards.

import BottomNav from "@/app/bottom-nav";

const bar = "block rounded bg-line";

export default function Loading() {
  return (
    <>
      <div className="sticky top-0 z-30 border-b border-hairline bg-surface">
        <div className="page-well pt-[calc(var(--safe-top)+1.5rem)] pb-3.5">
          <div className="flex items-center gap-3">
            <span className="-ml-2.5 h-11 w-11" />
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-[19px] font-bold tracking-tight">Community service</h1>
              <span className={`${bar} mt-1 h-3 w-32`} />
            </div>
          </div>
          <span className={`${bar} mt-2.5 h-3 w-56`} />
        </div>
      </div>

      <main className="page-well animate-pulse pt-4 pb-32 lg:pt-8 lg:pb-24">
        <ul className="flex flex-col gap-4 tablet:grid tablet:grid-cols-2 tablet:gap-4 lg:grid lg:grid-cols-2 lg:gap-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <li key={i} className="rounded-[20px] border border-line bg-surface p-4">
              <div className="flex gap-3">
                <div className="h-[52px] w-[52px] shrink-0 rounded-2xl bg-line" />
                <div className="min-w-0 flex-1">
                  <span className={`${bar} h-4 w-2/3`} />
                  <span className={`${bar} mt-2 h-3 w-1/3`} />
                  <span className={`${bar} mt-2 h-3 w-4/5`} />
                </div>
              </div>
              <div className="mt-3 border-t border-hairline pt-3">
                <span className={`${bar} h-3 w-40`} />
              </div>
            </li>
          ))}
        </ul>
      </main>

      <BottomNav />
    </>
  );
}
