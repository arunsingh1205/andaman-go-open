"use server";

// The partner's reviews — read from the partner_reviews view (024), which
// already resolves the listing name and is scoped to the caller's own
// partner. The per-listing and overall averages are computed here from the
// same rows rather than in SQL, since the list is small.

import { supabaseServer } from "./supabase-server";
import { istStampLabel } from "./partner-format";
import type { BookingKind } from "./bookings";

export type PartnerReview = {
  id: string;
  kind: BookingKind;
  subjectId: string;
  listingTitle: string;
  rating: number;
  body: string | null;
  reply: string | null;
  createdAtLabel: string;
};

export type ListingRating = {
  subjectId: string;
  listingTitle: string;
  average: number;
  count: number;
};

export type PartnerReviewsData = {
  reviews: PartnerReview[];
  perListing: ListingRating[];
  overall: { average: number; count: number };
};

type Row = {
  id: string;
  kind: BookingKind;
  subject_id: string;
  listing_title: string | null;
  rating: number;
  body: string | null;
  reply: string | null;
  created_at: string;
};

const avg = (nums: number[]) =>
  nums.length === 0 ? 0 : Math.round((nums.reduce((s, n) => s + n, 0) / nums.length) * 10) / 10;

export async function getPartnerReviews(): Promise<PartnerReviewsData> {
  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from("partner_reviews")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Supabase: could not load reviews — ${error.message}`);
  }

  const rows = (data ?? []) as Row[];

  const reviews: PartnerReview[] = rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    subjectId: row.subject_id,
    listingTitle: row.listing_title ?? "A listing",
    rating: row.rating,
    body: row.body,
    reply: row.reply,
    createdAtLabel: istStampLabel(row.created_at),
  }));

  const byListing = new Map<string, PartnerReview[]>();
  for (const r of reviews) {
    const list = byListing.get(r.subjectId);
    if (list) list.push(r);
    else byListing.set(r.subjectId, [r]);
  }

  const perListing: ListingRating[] = [...byListing.entries()]
    .map(([subjectId, list]) => ({
      subjectId,
      listingTitle: list[0].listingTitle,
      average: avg(list.map((r) => r.rating)),
      count: list.length,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    reviews,
    perListing,
    overall: { average: avg(reviews.map((r) => r.rating)), count: reviews.length },
  };
}

export type ReplyResult = { ok: boolean; message: string };

export async function replyToReview(reviewId: string, reply: string): Promise<ReplyResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("reply_to_review", {
    p_review_id: reviewId,
    p_reply: reply,
  });
  if (error) return { ok: false, message: "Couldn't post that. Try again." };
  const row = Array.isArray(data) ? (data[0] as { ok: boolean; message: string }) : null;
  return { ok: Boolean(row?.ok), message: row?.message ?? "Couldn't post that." };
}
