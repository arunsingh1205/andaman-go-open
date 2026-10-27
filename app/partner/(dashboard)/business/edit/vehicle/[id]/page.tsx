import { redirect } from "next/navigation";
import { getPartnerSession } from "@/lib/partner-auth";
import { getOwnVehicle } from "@/lib/partner-register";
import EditVehicleForm from "./edit-vehicle-form";

export default async function EditVehiclePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getPartnerSession();
  if (!session) redirect("/partner/login");

  const vehicle = await getOwnVehicle(session.partnerId, id);
  if (!vehicle) redirect("/partner/business");

  return <EditVehicleForm partnerId={session.partnerId} vehicle={vehicle} />;
}
