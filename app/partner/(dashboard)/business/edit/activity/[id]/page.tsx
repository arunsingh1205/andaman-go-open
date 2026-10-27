import { redirect } from "next/navigation";
import { getPartnerSession } from "@/lib/partner-auth";
import { getOwnActivity } from "@/lib/partner-register";
import EditActivityForm from "./edit-activity-form";

export default async function EditActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getPartnerSession();
  if (!session) redirect("/partner/login");

  const activity = await getOwnActivity(session.partnerId, id);
  if (!activity) redirect("/partner/business");

  return <EditActivityForm partnerId={session.partnerId} activity={activity} />;
}
