import { redirect } from "next/navigation";
import { getPartnerSession } from "@/lib/partner-auth";
import { getOwnSailing } from "@/lib/partner-register";
import EditSailingForm from "./edit-sailing-form";

export default async function EditSailingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getPartnerSession();
  if (!session) redirect("/partner/login");

  const sailing = await getOwnSailing(session.partnerId, id);
  if (!sailing) redirect("/partner/business");

  return <EditSailingForm partnerId={session.partnerId} sailing={sailing} />;
}
