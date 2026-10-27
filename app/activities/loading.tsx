// Matches the redesigned Activities screen: white header + image-topped cards.

import BottomNav from "@/app/bottom-nav";

const bar = "block rounded bg-line";

function CardSkeleton() {
  return (
    <li className="overflow-hidden rounded-[20px] border border-line bg-surface">
      <div className="h-40 w-full bg-line" />
      <div className="p-4">
        <span className={`${bar} h-4 w-2/3`} />
        <span className={`${bar} mt-2 h-3 w-1/3`} />
        <span className={`${bar} mt-2 h-3 w-4/5`} />
        <div className="mt-3 border-t border-hairline pt-3">
          <span className={`${bar} h-3 w-28`} />
        </div>
      </div>
    </li>
  );
}

export default function Loading() {
  return (
    <>
      <div className="sticky top-0 z-30 border-b border-hairline bg-surface">
        <div className="page-well pt-[calc(var(--safe-top)+1.5rem)] pb-3.5">
          <div className="flex items-center gap-3">
            <span className="-ml-2.5 h-11 w-11" />
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-[19px] font-bold tracking-tight">Activities</h1>
              <span className={`${bar} mt-1 h-3 w-32`} />
            </div>
          </div>
          <span className={`${bar} mt-2.5 h-3 w-52`} />
        </div>
      </div>

      <main className="page-well animate-pulse pt-4 pb-32 lg:pt-8 lg:pb-24">
        <div className="flex gap-2">
          {[44, 60, 72, 56].map((w, i) => (
            <span key={i} className="h-9 rounded-full bg-line" style={{ width: w }} />
          ))}
        </div>
        <ul className="mt-4 flex flex-col gap-4 tablet:grid tablet:grid-cols-2 tablet:gap-4 lg:mt-6 lg:grid lg:grid-cols-3 lg:gap-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </ul>
      </main>

      <BottomNav />
    </>
  );
}
