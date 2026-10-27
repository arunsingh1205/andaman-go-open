import { getPartnerReviews } from "@/lib/partner-reviews";
import ReviewsView from "./reviews-view";

export default async function PartnerReviewsPage() {
  const data = await getPartnerReviews();

  return (
    <>
      <h2 className="font-display text-[20px] font-bold tracking-tight">Reviews</h2>
      <p className="mt-0.5 text-[12px] font-medium text-muted">
        What travellers said after being checked in.
      </p>

      <ReviewsView data={data} />
    </>
  );
}
