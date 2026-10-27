import { redirect } from "next/navigation";
import { getPartnerSession } from "@/lib/partner-auth";
import { getOwnEvent } from "@/lib/partner-register";
import EditEventForm from "./edit-event-form";

export default async function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getPartnerSession();
  if (!session) redirect("/partner/login");

  const event = await getOwnEvent(session.partnerId, id);
  if (!event) redirect("/partner/business");

  return <EditEventForm partnerId={session.partnerId} event={event} />;
}
