import { notFound, redirect } from "next/navigation";
import { getPartnerSession } from "@/lib/partner-auth";
import { getPartnerBookingDetail } from "@/lib/partner-booking-detail";
import BookingDetailView from "./booking-detail-view";

export default async function PartnerBookingDetailPage({
  params,
}: {
  params: Promise<{ itemId: string }>;
}) {
  const session = await getPartnerSession();
  if (!session) redirect("/partner/login");

  const { itemId } = await params;
  const detail = await getPartnerBookingDetail(itemId);
  if (!detail) notFound();

  return <BookingDetailView detail={detail} />;
}
