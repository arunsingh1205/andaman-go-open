import { redirect } from "next/navigation";
import { getPartnerSession } from "@/lib/partner-auth";
import { getOwnCommunityService } from "@/lib/partner-register";
import EditCommunityForm from "./edit-community-form";

export default async function EditCommunityServicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getPartnerSession();
  if (!session) redirect("/partner/login");

  const service = await getOwnCommunityService(session.partnerId, id);
  if (!service) redirect("/partner/business");

  return <EditCommunityForm service={service} partnerId={session.partnerId} />;
}
