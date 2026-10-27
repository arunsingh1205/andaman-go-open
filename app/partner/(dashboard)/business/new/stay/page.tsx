import { redirect } from "next/navigation";
import { getPartnerSession } from "@/lib/partner-auth";
import StayWizard from "./stay-wizard";

export default async function NewStayPage() {
  const session = await getPartnerSession();
  if (!session) redirect("/partner/login");
  if (session.role !== "owner") redirect("/partner/dashboard");

  return <StayWizard partnerId={session.partnerId} />;
}
