import { notFound } from "next/navigation";
import Link from "next/link";
import { getListingOwnerId } from "@/lib/admin-listing-edit";
import { getOwnActivity, getActivitySchedule } from "@/lib/partner-register";
import { BackIcon } from "@/app/icons";
import ScheduleActivityForm from "@/app/partner/(dashboard)/business/schedule/activity/[id]/schedule-activity-form";

// The timetable behind an activity, edited on the partner's behalf — 075.
// Only activities have a separate schedule (017); every other kind carries
// its recurrence on the row (or, for a stay, its room types) and is edited
// from ./.. directly.

export const dynamic = "force-dynamic";

export default async function AdminListingScheduleEditPage({
  params,
}: {
  params: Promise<{ kind: string; id: string }>;
}) {
  const { kind, id } = await params;
  if (kind !== "activity") notFound();

  const partnerId = await getListingOwnerId(kind, id);
  if (!partnerId) notFound();

  const backHref = `/admin/listings/${kind}/${id}/edit`;

  const [activity, slots] = await Promise.all([
    getOwnActivity(partnerId, id),
    getActivitySchedule(partnerId, id),
  ]);
  if (!activity || slots === null) notFound();

  return (
    <div className="mx-auto max-w-[560px]">
      <Link
        href={backHref}
        className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] font-bold text-muted hover:text-ink"
      >
        <BackIcon size={15} />
        Back to listing
      </Link>
      <div className="rounded-2xl border border-line bg-surface p-5">
        <ScheduleActivityForm
          admin
          backHref={backHref}
          activityId={id}
          activityName={activity.name}
          slots={slots}
          initialMode={activity.scheduleMode}
        />
      </div>
    </div>
  );
}
