// Instant placeholder Next.js shows the moment a partner taps a tab, while
// that route's own server component is still fetching its data — without
// this, switching tabs looks frozen for however long the fetch takes,
// instead of looking like it's doing something. Same page-title-then-cards
// shape almost every dashboard screen actually renders, so one generic
// skeleton covers all of them well enough for something shown this briefly.

function Bar({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-full bg-line ${className}`} />;
}

function CardSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-[18px] border border-line bg-surface p-4">
      <div className="h-11 w-11 shrink-0 animate-pulse rounded-[13px] bg-line" />
      <div className="min-w-0 flex-1">
        <Bar className="h-2.5 w-1/3" />
        <Bar className="mt-2.5 h-3.5 w-2/3" />
        <Bar className="mt-2 h-2.5 w-1/2" />
      </div>
    </div>
  );
}

export default function LoadingSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div aria-hidden="true">
      <Bar className="h-5 w-32" />
      <Bar className="mt-2 h-3 w-56" />
      <div className="mt-5 flex flex-col gap-2.5">
        {Array.from({ length: rows }, (_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
