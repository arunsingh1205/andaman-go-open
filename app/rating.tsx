// A listing's rating, or "New" when nobody's reviewed it yet.
//
// Every card used to render `★ {rating} ({reviews})` flat, so a listing a
// partner added an hour ago showed a zero-star rating. rating is 0 until the
// first review lands (see 031), so `reviews > 0` is the honest gate.

import { StarIcon } from "./icons";

export default function Rating({
  rating,
  reviews,
  size = 13,
  className = "",
}: {
  rating: string;
  reviews: number;
  size?: number;
  className?: string;
}) {
  if (reviews === 0) {
    return (
      <span className={`text-[11.5px] font-bold text-muted ${className}`}>New</span>
    );
  }

  return (
    <span className={`flex items-center gap-1.5 ${className}`}>
      <StarIcon size={size} className="text-sand" />
      <span className="text-[12.5px] font-bold">{rating}</span>
      <span className="text-[12px] font-medium text-muted">({reviews})</span>
    </span>
  );
}
