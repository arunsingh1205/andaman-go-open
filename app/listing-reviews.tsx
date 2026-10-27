// Traveller-facing reviews for one listing. An async server component — drop
// it below the booking panel on a detail page. Renders nothing when there
// are no reviews yet.

import { reviewsFor, type ReviewKind } from "@/lib/reviews";
import { StarIcon } from "@/app/icons";

function Stars({ rating, size = 13 }: { rating: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <StarIcon
          key={n}
          size={size}
          className={n <= Math.round(rating) ? "text-sand" : "text-line"}
        />
      ))}
    </span>
  );
}

export default async function ListingReviews({
  kind,
  slug,
}: {
  kind: ReviewKind;
  slug: string;
}) {
  const reviews = await reviewsFor(kind, slug);
  if (reviews.length === 0) return null;

  const avg =
    Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10;

  return (
    <section className="mt-8">
      <h2 className="text-[12px] font-bold tracking-wider text-muted uppercase">
        Traveller reviews
      </h2>

      <div className="mt-3 flex items-center gap-2">
        <Stars rating={avg} size={15} />
        <span className="text-[14px] font-bold">{avg.toFixed(1)}</span>
        <span className="text-[12px] font-medium text-muted">
          · {reviews.length} {reviews.length === 1 ? "review" : "reviews"}
        </span>
      </div>

      <ul className="mt-4 flex flex-col gap-3">
        {reviews.slice(0, 8).map((r, i) => (
          <li key={i} className="rounded-2xl border border-line bg-surface p-3.5">
            <div className="flex items-center justify-between">
              <Stars rating={r.rating} />
              <span className="text-[11px] font-semibold text-muted">{r.dateLabel}</span>
            </div>
            {r.body && (
              <p className="mt-2 text-[13px] leading-relaxed font-medium text-ink">{r.body}</p>
            )}
            {r.reply && (
              <div className="mt-2.5 rounded-xl bg-ground p-2.5">
                <p className="text-[10px] font-bold tracking-wider text-muted uppercase">
                  Response from the operator
                </p>
                <p className="mt-1 text-[12.5px] leading-relaxed font-medium text-muted">
                  {r.reply}
                </p>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
