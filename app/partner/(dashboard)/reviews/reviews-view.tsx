"use client";

// The Reviews tab. Read-only except for one thing a partner can do: post (or
// edit) a single public reply per review, through reply_to_review (024).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { replyToReview, type PartnerReview, type PartnerReviewsData } from "@/lib/partner-reviews";
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

export default function ReviewsView({ data }: { data: PartnerReviewsData }) {
  const { reviews, perListing, overall } = data;

  if (reviews.length === 0) {
    return (
      <div className="mt-12 flex flex-col items-center text-center">
        <Stars rating={0} size={18} />
        <p className="mt-3 text-[13.5px] font-medium text-muted">
          No reviews yet. Travellers can rate a booking once you&rsquo;ve checked them in.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="mt-5 flex items-center gap-4 rounded-[22px] border border-line bg-surface p-4 shadow-sm desk:rounded-2xl">
        <div className="text-center">
          <p className="font-display text-[30px] leading-none font-bold text-brand">
            {overall.average.toFixed(1)}
          </p>
          <div className="mt-1.5">
            <Stars rating={overall.average} size={12} />
          </div>
        </div>
        <p className="text-[12.5px] font-medium text-muted">
          {overall.count} {overall.count === 1 ? "review" : "reviews"} across your listings
        </p>
      </div>

      {perListing.length > 1 && (
        <ul className="mt-3 flex flex-col gap-2">
          {perListing.map((l) => (
            <li
              key={l.subjectId}
              className="flex items-center gap-3 rounded-[16px] border border-line bg-surface p-3.5 desk:rounded-xl desk:p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-bold">{l.listingTitle}</p>
                <p className="text-[11px] font-medium text-muted">
                  {l.count} {l.count === 1 ? "review" : "reviews"}
                </p>
              </div>
              <span className="flex shrink-0 items-center gap-1.5">
                <Stars rating={l.average} size={12} />
                <span className="text-[12.5px] font-bold">{l.average.toFixed(1)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      <h3 className="mt-7 text-[14.5px] font-bold">All reviews</h3>
      <ul className="mt-3 flex flex-col gap-2.5">
        {reviews.map((review) => (
          <ReviewCard key={review.id} review={review} />
        ))}
      </ul>
    </>
  );
}

function ReviewCard({ review }: { review: PartnerReview }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(review.reply ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const result = await replyToReview(review.id, text);
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    setEditing(false);
    router.refresh();
  };

  return (
    <li className="rounded-[18px] border border-line bg-surface p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <Stars rating={review.rating} />
        <span className="text-[11px] font-semibold text-muted">{review.createdAtLabel}</span>
      </div>
      <p className="mt-1.5 text-[11px] font-bold tracking-wider text-muted uppercase">
        {review.listingTitle}
      </p>
      {review.body && (
        <p className="mt-1.5 text-[13px] leading-relaxed font-medium text-ink">{review.body}</p>
      )}

      <div className="mt-3 border-t border-hairline pt-3">
        {review.reply !== null && !editing ? (
          <div className="rounded-[14px] bg-ground p-3 desk:rounded-xl">
            <p className="text-[10.5px] font-bold tracking-wider text-muted uppercase">
              Your reply
            </p>
            <p className="mt-1 text-[12.5px] leading-relaxed font-medium text-ink">{review.reply}</p>
            <button
              type="button"
              onClick={() => {
                setText(review.reply ?? "");
                setEditing(true);
              }}
              className="mt-2 text-[11.5px] font-bold text-brand"
            >
              Edit reply
            </button>
          </div>
        ) : editing ? (
          <div>
            <textarea
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              placeholder="Thanks for diving with us…"
              className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-[13px] font-medium outline-none focus:border-brand"
            />
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={submit}
                className="h-9 rounded-lg bg-brand px-4 text-[12px] font-bold text-white disabled:bg-line disabled:text-muted"
              >
                {busy ? "Posting…" : review.reply !== null ? "Save reply" : "Post reply"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setEditing(false)}
                className="h-9 rounded-lg border border-line bg-surface px-4 text-[12px] font-bold text-ink disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
            {problem && <p className="mt-2 text-[11.5px] font-medium text-warn">{problem}</p>}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-[12px] font-bold text-brand"
          >
            Reply publicly
          </button>
        )}
      </div>
    </li>
  );
}
