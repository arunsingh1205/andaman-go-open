import { redirect } from "next/navigation";
import { getPartnerSession } from "@/lib/partner-auth";
import { getOwnStay } from "@/lib/partner-register";
import EditStayForm from "./edit-stay-form";

export default async function EditStayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getPartnerSession();
  if (!session) redirect("/partner/login");

  const stay = await getOwnStay(session.partnerId, id);
  if (!stay) redirect("/partner/business");

  return <EditStayForm partnerId={session.partnerId} stay={stay} />;
}
