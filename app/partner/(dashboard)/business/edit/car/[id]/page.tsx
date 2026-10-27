import { redirect } from "next/navigation";
import { getPartnerSession } from "@/lib/partner-auth";
import { getOwnCar, getCarRoutes } from "@/lib/partner-cabs";
import { getCabPlaces } from "@/lib/cabs";
import { getOwnBusiness } from "@/lib/partner-register";
import { CAB_COMMISSION_BPS_FALLBACK } from "@/lib/pricing";
import EditCarForm from "./edit-car-form";

export default async function EditCarPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getPartnerSession();
  if (!session) redirect("/partner/login");

  const [car, routes, places, business] = await Promise.all([
    getOwnCar(session.partnerId, id),
    getCarRoutes(session.partnerId, id),
    getCabPlaces(),
    getOwnBusiness(session.partnerId),
  ]);
  if (!car) redirect("/partner/business");

  return (
    <EditCarForm
      partnerId={session.partnerId}
      car={car}
      routes={routes ?? []}
      places={places}
      commissionBps={business?.commissionBps ?? CAB_COMMISSION_BPS_FALLBACK}
    />
  );
}
