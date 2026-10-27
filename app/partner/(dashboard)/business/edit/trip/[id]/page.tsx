import { redirect } from "next/navigation";
import { getPartnerSession } from "@/lib/partner-auth";
import { getOwnTrip } from "@/lib/partner-register";
import EditTripForm from "./edit-trip-form";

export default async function EditTripPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getPartnerSession();
  if (!session) redirect("/partner/login");

  const trip = await getOwnTrip(session.partnerId, id);
  if (!trip) redirect("/partner/business");

  return <EditTripForm partnerId={session.partnerId} trip={trip} />;
}
