import { redirect } from "next/navigation";
import { getPartnerSession } from "@/lib/partner-auth";
import SailingForm from "./sailing-form";

export default async function NewSailingPage() {
  const session = await getPartnerSession();
  if (!session) redirect("/partner/login");

  return <SailingForm partnerId={session.partnerId} />;
}
