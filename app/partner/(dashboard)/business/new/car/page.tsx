import { redirect } from "next/navigation";
import { getPartnerSession } from "@/lib/partner-auth";
import { getOwnBusiness } from "@/lib/partner-register";
import { CAB_COMMISSION_BPS_FALLBACK } from "@/lib/pricing";
import CarForm from "./car-form";

export default async function NewCarPage() {
  const session = await getPartnerSession();
  if (!session) redirect("/partner/login");

  const business = await getOwnBusiness(session.partnerId);

  return (
    <CarForm
      partnerId={session.partnerId}
      commissionBps={business?.commissionBps ?? CAB_COMMISSION_BPS_FALLBACK}
    />
  );
}
