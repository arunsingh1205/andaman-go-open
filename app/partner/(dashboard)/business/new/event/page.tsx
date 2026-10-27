import { redirect } from "next/navigation";
import { getPartnerSession } from "@/lib/partner-auth";
import { getOwnBusiness } from "@/lib/partner-register";
import EventForm from "./event-form";

export default async function NewEventPage() {
  const session = await getPartnerSession();
  if (!session) redirect("/partner/login");

  // The island the business registered under, used only as the form's default
  // — an event company can point each listing at a different island (071).
  const business = await getOwnBusiness(session.partnerId);

  return <EventForm partnerId={session.partnerId} defaultIslandSlug={business?.islandSlug ?? ""} />;
}
