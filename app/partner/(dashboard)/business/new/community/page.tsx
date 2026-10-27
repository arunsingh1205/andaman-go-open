import { redirect } from "next/navigation";
import { getPartnerSession } from "@/lib/partner-auth";
import { getOwnBusiness } from "@/lib/partner-register";
import CommunityForm from "./community-form";

export default async function NewCommunityServicePage() {
  const session = await getPartnerSession();
  if (!session) redirect("/partner/login");
  if (session.role !== "owner") redirect("/partner/dashboard");

  // The island the business registered under, used only as the form's default —
  // an organiser can point each listing at a different island.
  const business = await getOwnBusiness(session.partnerId);

  return <CommunityForm partnerId={session.partnerId} defaultIslandSlug={business?.islandSlug ?? ""} />;
}
