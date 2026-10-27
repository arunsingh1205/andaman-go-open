import { redirect } from "next/navigation";
import { getPartnerSession } from "@/lib/partner-auth";
import { getOwnActivity, getActivitySchedule } from "@/lib/partner-register";
import ScheduleActivityForm from "./schedule-activity-form";

export default async function ScheduleActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getPartnerSession();
  if (!session) redirect("/partner/login");

  const activity = await getOwnActivity(session.partnerId, id);
  if (!activity) redirect("/partner/business");

  const slots = await getActivitySchedule(session.partnerId, id);
  if (slots === null) redirect("/partner/business");

  return (
    <ScheduleActivityForm
      activityId={id}
      activityName={activity.name}
      slots={slots}
      initialMode={activity.scheduleMode}
    />
  );
}
