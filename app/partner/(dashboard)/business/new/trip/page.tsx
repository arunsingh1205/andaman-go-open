import { redirect } from "next/navigation";
import { getPartnerSession } from "@/lib/partner-auth";
import TripForm from "./trip-form";

export default async function NewTripPage() {
  const session = await getPartnerSession();
  if (!session) redirect("/partner/login");

  return <TripForm partnerId={session.partnerId} />;
}
