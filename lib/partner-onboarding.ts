// The activation checklist on the Dashboard — "what's left before travellers
// can actually book you". Every step is derived from data the partner app
// already stores (the business row, the listings, the schedules); nothing
// here is tracked separately, so a step un-ticks itself if a partner removes
// a cover photo or a listing gets unlisted.

import { getOwnBusiness, getPartnerListings } from "./partner-register";
import { KIND_NEEDS_LICENSE } from "./partner-kind";
import { supabaseServer } from "./supabase-server";

export type ChecklistStep = {
  id: string;
  label: string;
  done: boolean;
  href: string;
};

export type PartnerOnboarding = {
  steps: ChecklistStep[];
  doneCount: number;
  total: number;
  complete: boolean;
};

/** True only when every activity has a timetable and every stay has room
 *  types — an approved-but-unschedulable listing isn't bookable. */
async function schedulesComplete(
  activityIds: string[],
  stayIds: string[],
): Promise<boolean> {
  const supabase = await supabaseServer();

  if (activityIds.length > 0) {
    const { data } = await supabase
      .from("activity_schedule")
      .select("activity_id")
      .in("activity_id", activityIds);
    const scheduled = new Set((data ?? []).map((r) => r.activity_id as string));
    if (!activityIds.every((id) => scheduled.has(id))) return false;
  }

  if (stayIds.length > 0) {
    const { data } = await supabase
      .from("stay_room_types")
      .select("stay_id")
      .in("stay_id", stayIds);
    const withRooms = new Set((data ?? []).map((r) => r.stay_id as string));
    if (!stayIds.every((id) => withRooms.has(id))) return false;
  }

  return true;
}

export async function getPartnerOnboarding(
  partnerId: string,
): Promise<PartnerOnboarding | null> {
  const business = await getOwnBusiness(partnerId);
  if (!business) return null;

  const listings = await getPartnerListings(partnerId);
  const activityIds = listings.filter((l) => l.kind === "activity").map((l) => l.id);
  const stayIds = listings.filter((l) => l.kind === "stay").map((l) => l.id);
  const hasSchedulable = activityIds.length > 0 || stayIds.length > 0;

  const needsLicense = KIND_NEEDS_LICENSE[business.kind] === true;

  const steps: ChecklistStep[] = [
    { id: "registered", label: "Business registered", done: true, href: "/partner/business" },
    {
      id: "cover",
      label: "Add a cover photo",
      done: business.coverPhotoPath !== null,
      href: "/partner/business",
    },
    {
      id: "address",
      label: "Add your address and Maps link",
      done: Boolean(business.address && business.mapsUrl),
      href: "/partner/business",
    },
    ...(needsLicense
      ? [
          {
            id: "license",
            label: "Add your licence",
            done: Boolean(business.licenseNumber && business.licenseDocPath),
            href: "/partner/business",
          },
        ]
      : []),
    {
      id: "listing",
      label: "Add your first listing",
      done: listings.length > 0,
      href: "/partner/business/new",
    },
    {
      id: "live",
      label: "Get a listing approved and live",
      done: listings.some((l) => l.isListed),
      href: "/partner/business",
    },
    ...(hasSchedulable
      ? [
          {
            id: "schedule",
            label: "Set your hours",
            done: await schedulesComplete(activityIds, stayIds),
            href: "/partner/business",
          },
        ]
      : []),
  ];

  const doneCount = steps.filter((s) => s.done).length;
  return {
    steps,
    doneCount,
    total: steps.length,
    complete: doneCount === steps.length,
  };
}
