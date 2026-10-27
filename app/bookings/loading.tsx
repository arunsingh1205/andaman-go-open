// Matches the Bookings screen: header, then day-grouped ticket cards while
// getBookingDays() reads Supabase.

import BottomNav from "@/app/bottom-nav";

const bar = "block rounded bg-line";

function ItemSkeleton() {
  return (
    <li className="flex items-center gap-3 rounded-[18px] border border-line bg-surface p-3.5">
      <span className="h-11 w-11 shrink-0 rounded-[13px] bg-line" />
      <div className="min-w-0 flex-1">
        <span className={`${bar} h-3.5 w-2/3`} />
        <span className={`${bar} mt-2 h-3 w-1/2`} />
      </div>
    </li>
  );
}

function DaySkeleton({ items }: { items: number }) {
  return (
    <div className="mt-5 first:mt-0">
      <span className={`${bar} h-3 w-32`} />
      <ul className="mt-2.5 flex flex-col gap-2.5">
        {Array.from({ length: items }).map((_, i) => (
          <ItemSkeleton key={i} />
        ))}
      </ul>
    </div>
  );
}

export default function Loading() {
  return (
    <>
      <div className="sticky top-0 z-30 border-b border-hairline bg-surface">
        <div className="page-well pt-[calc(var(--safe-top)+1.5rem)] pb-4">
          <h1 className="font-display text-[22px] font-bold tracking-tight">Bookings</h1>
          <p className="mt-0.5 text-[12px] font-medium text-muted">
            One reference a day. If the weather takes one thing, it takes the lot.
          </p>
        </div>
      </div>

      <main className="page-well animate-pulse pt-4 pb-32 lg:pt-8 lg:pb-24">
        <DaySkeleton items={2} />
        <DaySkeleton items={1} />
        <DaySkeleton items={1} />
      </main>

      <BottomNav />
    </>
  );
}
