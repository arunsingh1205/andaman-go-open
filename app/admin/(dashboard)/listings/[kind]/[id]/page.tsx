import { notFound } from "next/navigation";
import { getListingForReview, type ListingKind } from "@/lib/admin-review";
import ListingReviewView from "./listing-review-view";

// One submitted listing, with everything Arun needs to decide whether it goes
// live — the photos, the description, the price, the timetable, the business.
// The queue at /admin/listings still carries a fast inline approve/reject; this
// is the "actually look at it first" route.

export const dynamic = "force-dynamic";

const KINDS: readonly string[] = [
  "activity",
  "rental",
  "cab",
  "stay",
  "event",
  "trip",
  "ferry",
  "community",
];

export default async function AdminListingReviewPage({
  params,
}: {
  params: Promise<{ kind: string; id: string }>;
}) {
  const { kind, id } = await params;
  if (!KINDS.includes(kind)) notFound();

  const listing = await getListingForReview(kind as ListingKind, id);
  if (!listing) notFound();

  return <ListingReviewView listing={listing} />;
}
