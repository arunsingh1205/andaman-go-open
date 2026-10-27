// Placeholder for a listing detail route while it reads Supabase. Shape
// matches the back link + photo carousel + title block + booking panel.

const bar = "block rounded bg-line";

export default function DetailSkeleton() {
  return (
    <main className="page-well animate-pulse pt-[calc(var(--safe-top)+1.5rem)] pb-16">
      <span className={`${bar} h-4 w-24`} />

      <div className="mt-4 aspect-[4/3] w-full rounded-2xl bg-line" />

      <div className="mt-4 flex gap-3">
        <span className="h-[62px] w-[62px] shrink-0 rounded-2xl bg-line" />
        <div className="min-w-0 flex-1">
          <span className={`${bar} h-5 w-3/4`} />
          <span className={`${bar} mt-2 h-3 w-1/2`} />
        </div>
      </div>

      <span className={`${bar} mt-5 h-3 w-full`} />
      <span className={`${bar} mt-2 h-3 w-full`} />
      <span className={`${bar} mt-2 h-3 w-2/3`} />

      <div className="mt-8 h-56 w-full rounded-2xl bg-line" />
    </main>
  );
}
