import { listAdminReviews } from "@/lib/admin-reviews";
import ReviewsView from "./reviews-view";

export const dynamic = "force-dynamic";

export default async function AdminReviewsPage() {
  const reviews = await listAdminReviews();
  return <ReviewsView reviews={reviews} />;
}
