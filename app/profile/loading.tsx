// Matches the Profile screen: avatar + stats header, next-up card, then the
// Contact and Notifications sections, while getBookingDays()/getMyPhone()/
// getMyEmail() read Supabase.

import BottomNav from "@/app/bottom-nav";

const bar = "block rounded bg-line";

export default function Loading() {
  return (
    <>
      <div className="sticky top-0 z-30 animate-pulse border-b border-hairline bg-surface">
        <div className="page-well pt-[calc(var(--safe-top)+1.5rem)] pb-5">
          <div className="flex items-center gap-3.5">
            <span className="h-14 w-14 shrink-0 rounded-2xl bg-line" />
            <div className="min-w-0 flex-1">
              <span className={`${bar} h-4 w-36`} />
              <span className={`${bar} mt-2 h-3 w-24`} />
            </div>
          </div>

          <div className="mt-4 flex gap-2.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex-1 rounded-[15px] border border-line bg-ground px-3 py-2.5">
                <span className={`${bar} mx-auto h-4 w-6`} />
                <span className={`${bar} mx-auto mt-1.5 h-2.5 w-12`} />
              </div>
            ))}
          </div>
        </div>
      </div>

      <main className="page-well animate-pulse pt-4 pb-32 lg:pt-8 lg:pb-24">
        <div className="flex items-center gap-3 rounded-[18px] border border-line bg-surface p-4">
          <span className="h-11 w-11 shrink-0 rounded-[13px] bg-line" />
          <div className="min-w-0 flex-1">
            <span className={`${bar} h-3 w-16`} />
            <span className={`${bar} mt-1.5 h-3.5 w-1/2`} />
          </div>
        </div>

        <span className={`${bar} mt-7 h-3 w-20`} />
        <span className={`${bar} mt-2 h-3 w-56`} />
        <div className="mt-2.5 flex flex-col gap-2.5">
          <span className="block h-14 rounded-[15px] bg-line" />
          <span className="block h-14 rounded-[15px] bg-line" />
        </div>

        <span className={`${bar} mt-7 h-3 w-28`} />
        <div className="mt-2.5 h-14 rounded-[15px] bg-line" />
      </main>

      <BottomNav />
    </>
  );
}
