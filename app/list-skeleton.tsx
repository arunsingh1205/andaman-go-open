// What a list route shows while its Server Component is still reading Supabase.
// Every list page is force-dynamic, so without this there's a blank few hundred
// ms on each navigation. Shape matches the real header + list cards.

import BottomNav from "./bottom-nav";

const bar = "block rounded bg-line";

function CardSkeleton() {
  return (
    <li className="rounded-[18px] border border-line bg-surface p-3.5">
      <div className="flex gap-3.5">
        <span className="h-[62px] w-[62px] shrink-0 rounded-[15px] bg-line" />
        <div className="min-w-0 flex-1">
          <span className={`${bar} h-3.5 w-2/3`} />
          <span className={`${bar} mt-2 h-3 w-1/3`} />
          <span className={`${bar} mt-2 h-3 w-4/5`} />
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-hairline pt-3">
        <span className={`${bar} h-3 w-16`} />
        <span className={`${bar} h-3 w-20`} />
      </div>
    </li>
  );
}

export default function ListSkeleton({ title }: { title: string }) {
  return (
    <>
      <div className="sticky top-0 z-30 border-b border-hairline bg-surface">
        <div className="page-well flex items-center gap-3 pt-[calc(var(--safe-top)+1.5rem)] pb-4">
          <span className="-ml-2.5 h-11 w-11" />
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-[19px] font-bold tracking-tight">{title}</h1>
            <span className={`${bar} mt-1 h-3 w-32`} />
          </div>
          <span className="h-7 w-24 rounded-full bg-line" />
        </div>
      </div>

      <main className="page-well animate-pulse pt-4 pb-32 lg:pt-8 lg:pb-24">
        <div className="flex gap-2">
          {[44, 60, 72, 56].map((w, i) => (
            <span key={i} className="h-11 rounded-full bg-line" style={{ width: w }} />
          ))}
        </div>
        <ul className="mt-4 flex flex-col gap-3 tablet:grid tablet:grid-cols-2 tablet:gap-4 lg:mt-6 lg:grid lg:grid-cols-3 lg:gap-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </ul>
      </main>

      <BottomNav />
    </>
  );
}
