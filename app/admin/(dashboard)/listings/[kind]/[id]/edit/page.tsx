import { notFound } from "next/navigation";
import Link from "next/link";
import { getListingOwnerId } from "@/lib/admin-listing-edit";
import {
  getOwnActivity,
  getOwnVehicle,
  getOwnStay,
  getOwnEvent,
  getOwnTrip,
  getOwnSailing,
  getOwnCommunityService,
  getOwnBusiness,
} from "@/lib/partner-register";
import { getOwnCar, getCarRoutes } from "@/lib/partner-cabs";
import { getCabPlaces } from "@/lib/cabs";
import { CAB_COMMISSION_BPS_FALLBACK } from "@/lib/pricing";
import { BackIcon } from "@/app/icons";
import EditActivityForm from "@/app/partner/(dashboard)/business/edit/activity/[id]/edit-activity-form";
import EditVehicleForm from "@/app/partner/(dashboard)/business/edit/vehicle/[id]/edit-vehicle-form";
import EditCarForm from "@/app/partner/(dashboard)/business/edit/car/[id]/edit-car-form";
import EditStayForm from "@/app/partner/(dashboard)/business/edit/stay/[id]/edit-stay-form";
import EditEventForm from "@/app/partner/(dashboard)/business/edit/event/[id]/edit-event-form";
import EditTripForm from "@/app/partner/(dashboard)/business/edit/trip/[id]/edit-trip-form";
import EditSailingForm from "@/app/partner/(dashboard)/business/edit/sailing/[id]/edit-sailing-form";
import EditCommunityForm from "@/app/partner/(dashboard)/business/edit/community/[id]/edit-community-form";

// Edit any field of a partner's listing, on their behalf — 075. The forms are
// the exact ones the partner uses on their own Business tab; the `admin` prop
// swaps every save onto the admin_* RPCs, which (unlike the partner path)
// leave a live listing live. Activity schedules live one level deeper, at
// ./edit/schedule — a stay's room types are edited right on this page.

export const dynamic = "force-dynamic";

const KINDS = [
  "activity",
  "rental",
  "cab",
  "stay",
  "event",
  "trip",
  "ferry",
  "community",
] as const;
type Kind = (typeof KINDS)[number];

export default async function AdminListingEditPage({
  params,
}: {
  params: Promise<{ kind: string; id: string }>;
}) {
  const { kind, id } = await params;
  if (!KINDS.includes(kind as Kind)) notFound();

  const partnerId = await getListingOwnerId(kind, id);
  if (!partnerId) notFound();

  const backHref = `/admin/listings/${kind}/${id}`;
  const k = kind as Kind;

  let form: React.ReactNode = null;

  if (k === "activity") {
    const activity = await getOwnActivity(partnerId, id);
    if (!activity) notFound();
    form = <EditActivityForm admin backHref={backHref} partnerId={partnerId} activity={activity} />;
  } else if (k === "rental") {
    const vehicle = await getOwnVehicle(partnerId, id);
    if (!vehicle) notFound();
    form = <EditVehicleForm admin backHref={backHref} partnerId={partnerId} vehicle={vehicle} />;
  } else if (k === "cab") {
    const [car, routes, places, business] = await Promise.all([
      getOwnCar(partnerId, id),
      getCarRoutes(partnerId, id),
      getCabPlaces(),
      getOwnBusiness(partnerId),
    ]);
    if (!car) notFound();
    form = (
      <EditCarForm
        admin
        backHref={backHref}
        partnerId={partnerId}
        car={car}
        routes={routes ?? []}
        places={places}
        commissionBps={business?.commissionBps ?? CAB_COMMISSION_BPS_FALLBACK}
      />
    );
  } else if (k === "stay") {
    const stay = await getOwnStay(partnerId, id);
    if (!stay) notFound();
    form = <EditStayForm admin backHref={backHref} partnerId={partnerId} stay={stay} />;
  } else if (k === "event") {
    const event = await getOwnEvent(partnerId, id);
    if (!event) notFound();
    form = <EditEventForm admin backHref={backHref} partnerId={partnerId} event={event} />;
  } else if (k === "trip") {
    const trip = await getOwnTrip(partnerId, id);
    if (!trip) notFound();
    form = <EditTripForm admin backHref={backHref} partnerId={partnerId} trip={trip} />;
  } else if (k === "ferry") {
    const sailing = await getOwnSailing(partnerId, id);
    if (!sailing) notFound();
    form = <EditSailingForm admin backHref={backHref} partnerId={partnerId} sailing={sailing} />;
  } else {
    const service = await getOwnCommunityService(partnerId, id);
    if (!service) notFound();
    form = <EditCommunityForm admin backHref={backHref} partnerId={partnerId} service={service} />;
  }

  return (
    <div className="mx-auto max-w-[560px]">
      <Link
        href={backHref}
        className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] font-bold text-muted hover:text-ink"
      >
        <BackIcon size={15} />
        Back to review
      </Link>
      <div className="rounded-2xl border border-line bg-surface p-5">
        <p className="mb-3 rounded-xl border border-brandsoft bg-brandsoft px-3.5 py-2.5 text-[12px] font-semibold text-brand">
          Editing on the partner&apos;s behalf. Saving here does not take a live listing offline.
        </p>
        {form}
        {k === "activity" && (
          <Link
            href={`${backHref}/edit/schedule`}
            className="mt-4 inline-flex items-center gap-1.5 text-[12.5px] font-bold text-brand hover:underline"
          >
            Edit time slots →
          </Link>
        )}
      </div>
    </div>
  );
}
