// Matches the Ferry search screen: brand header with route picker + day
// chips, a passenger stepper, then the sailing list.

import BottomNav from "@/app/bottom-nav";

const bar = "block rounded bg-line";

function SailingSkeleton() {
  return (
    <li className="rounded-[18px] border border-line bg-surface p-4">
      <div className="flex items-center gap-2.5">
        <span className="h-8 w-8 shrink-0 rounded-[10px] bg-line" />
        <span className={`${bar} h-3.5 w-1/3`} />
      </div>
      <div className="mt-3 flex items-center justify-between">
        <span className={`${bar} h-4 w-16`} />
        <span className={`${bar} h-3 w-12`} />
        <span className={`${bar} h-4 w-16`} />
      </div>
    </li>
  );
}

export default function Loading() {
  return (
    <>
      <div className="animate-pulse bg-brand pt-[calc(var(--safe-top)+1rem)] pb-4">
        <div className="page-flow">
          <div className="flex items-center gap-3">
            <span className="h-11 w-11 shrink-0 rounded-full bg-white/15" />
            <div className="flex flex-1 items-center gap-3 rounded-2xl bg-white/10 px-4 py-3">
              <span className="h-9 flex-1 rounded bg-white/15" />
              <span className="h-11 w-11 shrink-0 rounded-full bg-white/20" />
              <span className="h-9 flex-1 rounded bg-white/15" />
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            {[64, 64, 64, 64].map((w, i) => (
              <span key={i} className="h-11 shrink-0 rounded-xl bg-white/10" style={{ width: w }} />
            ))}
          </div>
        </div>
      </div>

      <div className="page-flow mt-3 animate-pulse">
        <div className="h-[52px] w-full rounded-2xl bg-line" />
      </div>

      <main className="page-flow animate-pulse pt-3.5 pb-36">
        <ul className="flex flex-col gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <SailingSkeleton key={i} />
          ))}
        </ul>
      </main>

      <BottomNav />
    </>
  );
}
