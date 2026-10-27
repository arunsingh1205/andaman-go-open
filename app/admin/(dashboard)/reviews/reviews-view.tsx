"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { removeReview, type AdminReview } from "@/lib/admin-reviews";
import { PageHeader, Panel, ChipRow, Chip, EmptyState } from "../admin-ui";
import { StarIcon } from "@/app/icons";

function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${rating} of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <StarIcon key={n} size={13} className={n <= rating ? "text-sand" : "text-line"} />
      ))}
    </span>
  );
}

const FILTERS = [
  { key: "all", label: "All" },
  { key: "low", label: "1–2 ★" },
  { key: "mid", label: "3 ★" },
  { key: "high", label: "4–5 ★" },
];

export default function ReviewsView({ reviews }: { reviews: AdminReview[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const shown = useMemo(() => {
    if (filter === "low") return reviews.filter((r) => r.rating <= 2);
    if (filter === "mid") return reviews.filter((r) => r.rating === 3);
    if (filter === "high") return reviews.filter((r) => r.rating >= 4);
    return reviews;
  }, [reviews, filter]);

  const remove = async (id: string) => {
    setBusy(id);
    await removeReview(id);
    setBusy(null);
    setConfirming(null);
    router.refresh();
  };

  const avg =
    reviews.length === 0
      ? 0
      : Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10;

  return (
    <>
      <PageHeader
        title="Reviews"
        subtitle={
          reviews.length === 0
            ? "No reviews yet"
            : `${reviews.length} across the platform · ${avg.toFixed(1)} average`
        }
      />

      <ChipRow>
        {FILTERS.map((f) => (
          <Chip
            key={f.key}
            label={f.label}
            active={filter === f.key}
            onClick={() => setFilter(f.key)}
          />
        ))}
      </ChipRow>

      <Panel className="mt-4">
        {shown.length === 0 ? (
          <EmptyState>No review matches that filter.</EmptyState>
        ) : (
          <ul className="divide-y divide-hairline">
            {shown.map((r) => (
              <li key={r.id} className="px-5 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Stars rating={r.rating} />
                    <Link
                      href={`/admin/partners/${r.partnerId}`}
                      className="text-[12.5px] font-bold text-brand hover:underline"
                    >
                      {r.partnerName}
                    </Link>
                    <span className="text-[11.5px] font-medium text-muted">· {r.listingTitle}</span>
                  </div>
                  <span className="shrink-0 text-[11px] font-semibold text-muted">{r.dateLabel}</span>
                </div>

                {r.body && (
                  <p className="mt-1.5 text-[12.5px] leading-relaxed font-medium text-ink">{r.body}</p>
                )}
                {r.reply && (
                  <p className="mt-1.5 border-l-2 border-line pl-2.5 text-[12px] font-medium text-muted">
                    Operator: {r.reply}
                  </p>
                )}

                <div className="mt-2">
                  {confirming === r.id ? (
                    <span className="flex items-center gap-2 text-[11.5px] font-bold">
                      <span className="text-warn">Remove this review permanently?</span>
                      <button
                        type="button"
                        disabled={busy === r.id}
                        onClick={() => remove(r.id)}
                        className="rounded-md bg-warn px-2 py-1 text-white disabled:opacity-50"
                      >
                        {busy === r.id ? "…" : "Remove"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirming(null)}
                        className="rounded-md border border-line px-2 py-1 text-muted"
                      >
                        Keep
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirming(r.id)}
                      className="text-[11.5px] font-bold text-muted hover:text-warn"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
