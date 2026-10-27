"use client";

// The interactive listing list — same rows, same resubmit/delete/schedule
// actions — shared by the Business tab (a compact link there now) and the
// dedicated My Listings page. Pulled out of business-view.tsx so the two
// screens don't drift into two copies of "how to render a listing."

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { resubmitPartnerListing, deletePartnerListing, type OwnListing } from "@/lib/partner-register";
import {
  BedIcon,
  CarIcon,
  CheckIcon,
  ClockIcon,
  CloseIcon,
  DiveIcon,
  FerryIcon,
  HandsIcon,
  MusicIcon,
  PlanIcon,
  ScooterIcon,
} from "@/app/icons";

export const LISTING_ICON = {
  activity: DiveIcon,
  rental: ScooterIcon,
  cab: CarIcon,
  stay: BedIcon,
  event: MusicIcon,
  trip: PlanIcon,
  ferry: FerryIcon,
  community: HandsIcon,
} as const;
// The "edit" route folders are named after the add-listing forms they mirror
// (business/new/vehicle, not business/new/rental) — this maps the OwnListing
// kind to that folder name.
export const LISTING_EDIT_SEGMENT = {
  activity: "activity",
  rental: "vehicle",
  cab: "car",
  stay: "stay",
  event: "event",
  trip: "trip",
  ferry: "sailing",
  community: "community",
} as const;
// Only activities have a separate timetable (activity_schedule) — see
// 017-partner-schedule-editor.sql. A stay's room types are added on its edit
// page instead (there's no separate "schedule" for a property), so 'stay' is
// deliberately not in this map — see needsTimesHref below.
export const LISTING_SCHEDULE_SEGMENT: Partial<Record<OwnListing["kind"], string>> = {
  activity: "activity",
};

/** Where the "no times/rooms set yet" nudge sends a partner — the schedule
 *  editor for a kind that has one, or straight to Edit for a stay (room
 *  types live on that page, not a separate schedule route). */
function needsTimesHref(item: OwnListing): string {
  const segment = LISTING_SCHEDULE_SEGMENT[item.kind];
  return segment
    ? `/partner/business/schedule/${segment}/${item.id}`
    : `/partner/business/edit/${LISTING_EDIT_SEGMENT[item.kind]}/${item.id}`;
}

export default function ListingsSection({ listings }: { listings: OwnListing[] }) {
  const router = useRouter();
  const [resubmittingListing, setResubmittingListing] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [deletingListing, setDeletingListing] = useState<string | null>(null);

  const resubmitListing = async (item: OwnListing) => {
    setResubmittingListing(item.id);
    const result = await resubmitPartnerListing(item.kind, item.id);
    setResubmittingListing(null);
    if (result.ok) router.refresh();
  };

  const deleteListing = async (item: OwnListing) => {
    setDeletingListing(item.id);
    const result = await deletePartnerListing(item.kind, item.id);
    setDeletingListing(null);
    setConfirmingDelete(null);
    if (result.ok) router.refresh();
  };

  if (listings.length === 0) {
    return (
      <p className="mt-4 text-[13px] font-medium text-muted">
        Nothing added yet. Add your first activity, rental or room to get started.
      </p>
    );
  }

  return (
    <ul className="mt-3 flex flex-col gap-2">
      {listings.map((item) => {
        const Icon = LISTING_ICON[item.kind];
        return (
          <li key={`${item.kind}-${item.id}`} className="rounded-[16px] border border-line bg-surface p-3.5 desk:rounded-xl desk:p-3">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-brandsoft text-brand desk:h-9 desk:w-9 desk:rounded-lg">
                <Icon size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-bold">{item.title}</p>
                <p className="text-[11.5px] font-medium text-muted">{item.detail}</p>
              </div>
              {item.isListed ? (
                <span className="flex items-center gap-1 rounded-full bg-brandsoft px-2 py-1 text-[10.5px] font-bold text-brand">
                  <CheckIcon size={11} />
                  Live
                </span>
              ) : item.rejectionReason ? (
                <span className="flex items-center gap-1 rounded-full bg-sandsoft px-2 py-1 text-[10.5px] font-bold text-warn">
                  <CloseIcon size={11} />
                  Not approved
                </span>
              ) : (
                <span className="flex items-center gap-1 rounded-full bg-sandsoft px-2 py-1 text-[10.5px] font-bold text-sandink2">
                  <ClockIcon size={11} />
                  In review
                </span>
              )}
            </div>
            {item.rejectionReason && (
              <div className="mt-2.5 border-t border-hairline pt-2.5">
                <p className="text-[11.5px] font-medium text-warn">{item.rejectionReason}</p>
                <button
                  type="button"
                  disabled={resubmittingListing === item.id}
                  onClick={() => resubmitListing(item)}
                  className="mt-1.5 h-8 rounded-lg border border-line bg-surface px-3 text-[11.5px] font-bold text-ink disabled:opacity-50"
                >
                  {resubmittingListing === item.id ? "Sending…" : "Resubmit for review"}
                </button>
              </div>
            )}
            {item.needsTimes && !item.rejectionReason && (
              <div className="mt-2.5 rounded-[14px] border border-sandline bg-sandsoft p-2.5 desk:rounded-lg">
                <p className="text-[11.5px] font-medium text-sandink2">
                  No times set yet — travellers can&apos;t book this, and Andaman Go can&apos;t
                  approve it until you add some.
                </p>
                <Link
                  href={needsTimesHref(item)}
                  className="mt-1.5 inline-flex h-8 items-center rounded-lg bg-sand px-3 text-[11.5px] font-bold text-white"
                >
                  {item.kind === "stay" ? "Add room types" : "Add time slots"}
                </Link>
              </div>
            )}
            <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-hairline pt-2.5">
              <Link
                href={`/partner/business/edit/${LISTING_EDIT_SEGMENT[item.kind]}/${item.id}`}
                className="inline-flex h-8 items-center rounded-lg border border-line bg-surface px-3 text-[11.5px] font-bold text-ink"
              >
                Edit
              </Link>
              {LISTING_SCHEDULE_SEGMENT[item.kind] && (
                <Link
                  href={`/partner/business/schedule/${LISTING_SCHEDULE_SEGMENT[item.kind]}/${item.id}`}
                  className="inline-flex h-8 items-center rounded-lg border border-line bg-surface px-3 text-[11.5px] font-bold text-ink"
                >
                  Hours
                </Link>
              )}
              {item.isListed && (
                <span className="text-[11px] font-medium text-muted">
                  Editing this sends it back for a quick recheck first.
                </span>
              )}
              {confirmingDelete !== item.id && (
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(item.id)}
                  className="ml-auto inline-flex h-8 items-center rounded-lg border border-line bg-surface px-3 text-[11.5px] font-bold text-warn hover:border-warn"
                >
                  Delete
                </button>
              )}
            </div>
            {confirmingDelete === item.id && (
              <div className="mt-2.5 rounded-[14px] border border-line bg-ground p-2.5 desk:rounded-lg">
                <p className="text-[11.5px] font-medium text-muted">
                  This removes it for good — travellers won&apos;t see it again, and there&apos;s no
                  bringing it back. Bookings already made are left as they are.
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={deletingListing === item.id}
                    onClick={() => deleteListing(item)}
                    className="h-8 flex-1 rounded-lg bg-warn text-[11.5px] font-bold text-white disabled:opacity-60"
                  >
                    {deletingListing === item.id ? "Deleting…" : "Confirm delete"}
                  </button>
                  <button
                    type="button"
                    disabled={deletingListing === item.id}
                    onClick={() => setConfirmingDelete(null)}
                    className="h-8 rounded-lg border border-line bg-surface px-3 text-[11.5px] font-bold text-ink disabled:opacity-50"
                  >
                    Never mind
                  </button>
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
