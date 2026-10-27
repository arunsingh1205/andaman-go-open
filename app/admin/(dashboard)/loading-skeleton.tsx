// Instant placeholder Next.js shows the moment an admin clicks a nav item,
// while that route's own server component is still fetching its data —
// without this there's no loading.tsx anywhere under /admin at all, so a
// click just sits frozen for however long the query takes, then snaps
// straight to the new page. Same shared-skeleton approach the partner
// dashboard uses (app/partner/(dashboard)/loading-skeleton.tsx): one
// generic shape — title, a couple of stat tiles, a panel of list rows — is
// close enough to most admin screens for something shown this briefly, and
// it's reused by every route's own thin loading.tsx below the layout.

function Bar({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-full bg-line ${className}`} />;
}

function TileSkeleton() {
  return (
    <div className="rounded-card border border-line bg-surface p-4">
      <Bar className="h-2.5 w-2/3" />
      <Bar className="mt-3 h-6 w-10" />
      <Bar className="mt-2.5 h-2.5 w-4/5" />
    </div>
  );
}

function RowSkeleton() {
  return (
    <div className="flex items-center gap-3 border-b border-hairline px-5 py-4 last:border-b-0">
      <div className="h-10 w-10 shrink-0 animate-pulse rounded-control bg-line" />
      <div className="min-w-0 flex-1">
        <Bar className="h-3 w-1/3" />
        <Bar className="mt-2.5 h-2.5 w-1/2" />
      </div>
    </div>
  );
}

export default function LoadingSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-hidden="true">
      <Bar className="h-6 w-40" />
      <Bar className="mt-2.5 h-3 w-64" />

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <TileSkeleton />
        <TileSkeleton />
        <TileSkeleton />
        <TileSkeleton />
      </div>

      <div className="mt-5 rounded-panel border border-line bg-surface">
        {Array.from({ length: rows }, (_, i) => (
          <RowSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
