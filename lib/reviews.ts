// Reviews for one listing, for the traveller-facing detail pages. Reads
// through listing_reviews (031), which resolves the slug and returns only
// safe columns — no reviewer identity.

import { supabase, unwrap } from "./supabase";

export type ReviewKind = "activity" | "stay" | "event" | "trip" | "cab" | "rental";

export type ListingReview = {
  rating: number;
  body: string | null;
  reply: string | null;
  dateLabel: string;
};

export async function reviewsFor(
  kind: ReviewKind,
  slug: string,
): Promise<ListingReview[]> {
  const rows = unwrap(
    await supabase.rpc("listing_reviews", { p_kind: kind, p_subject: slug }),
    `reviews for ${kind} "${slug}"`,
  ) as { rating: number; body: string | null; reply: string | null; created_at: string }[];

  return rows.map((r) => ({
    rating: r.rating,
    body: r.body,
    reply: r.reply,
    dateLabel: new Date(r.created_at).toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
      timeZone: "Asia/Kolkata",
    }),
  }));
}
