import { redirect } from "next/navigation";
import { getPartnerSession } from "@/lib/partner-auth";
import { getOwnBusiness } from "@/lib/partner-register";
import VehicleForm from "./vehicle-form";

export default async function NewVehiclePage() {
  const session = await getPartnerSession();
  if (!session) redirect("/partner/login");

  // Prefilled from whatever's already on the shop (127/128) — a partner
  // adding their second or third vehicle shouldn't have to retype the same
  // area/map link they already set on the first.
  const business = await getOwnBusiness(session.partnerId);

  return (
    <VehicleForm
      partnerId={session.partnerId}
      initialArea={business?.area ?? ""}
      initialMapsUrl={business?.mapsUrl ?? ""}
    />
  );
}
