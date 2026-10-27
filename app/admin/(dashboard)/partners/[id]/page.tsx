import { notFound } from "next/navigation";
import { getPartner, listListingsForPartner } from "@/lib/admin-review";
import { getAdminBookings } from "@/lib/admin-bookings";
import { getAdminPartnerOverview } from "@/lib/admin-partner-overview";
import PartnerDetailView from "./partner-detail-view";

// One business, everything about it, in one place.
//
// This screen is the reason the Partners tab stopped being a queue. Deciding
// whether a business belongs on the app means looking at its licence, its
// listings and what it has actually delivered — three things that used to
// live on three different screens, or nowhere at all. Approving is a
// consequence of having looked, so the buttons live here, next to what you
// are supposed to have read.

export const dynamic = "force-dynamic";

export default async function AdminPartnerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const partner = await getPartner(id);
  if (!partner) notFound();

  const [listings, bookings, overview] = await Promise.all([
    listListingsForPartner(id),
    getAdminBookings({ partnerId: id, window: "all" }),
    getAdminPartnerOverview(id),
  ]);

  return (
    <PartnerDetailView
      partner={partner}
      listings={listings}
      bookings={bookings}
      overview={overview}
    />
  );
}
