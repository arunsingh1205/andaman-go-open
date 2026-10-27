import { redirect } from "next/navigation";
import { getPartnerSession } from "@/lib/partner-auth";
import ActivityForm from "./activity-form";

export default async function NewActivityPage() {
  const session = await getPartnerSession();
  if (!session) redirect("/partner/login");

  return <ActivityForm partnerId={session.partnerId} />;
}
