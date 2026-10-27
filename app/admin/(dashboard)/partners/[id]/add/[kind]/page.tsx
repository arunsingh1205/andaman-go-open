import { notFound } from "next/navigation";
import Link from "next/link";
import { getPartner } from "@/lib/admin-review";
import { getOwnBusiness } from "@/lib/partner-register";
import { CAB_COMMISSION_BPS_FALLBACK } from "@/lib/pricing";
import { BackIcon } from "@/app/icons";
import ActivityForm from "@/app/partner/(dashboard)/business/new/activity/activity-form";
import VehicleForm from "@/app/partner/(dashboard)/business/new/vehicle/vehicle-form";
import CarForm from "@/app/partner/(dashboard)/business/new/car/car-form";
import StayWizard from "@/app/partner/(dashboard)/business/new/stay/stay-wizard";
import EventForm from "@/app/partner/(dashboard)/business/new/event/event-form";
import TripForm from "@/app/partner/(dashboard)/business/new/trip/trip-form";
import SailingForm from "@/app/partner/(dashboard)/business/new/sailing/sailing-form";
import CommunityForm from "@/app/partner/(dashboard)/business/new/community/community-form";

// Add a listing for a business, on their behalf — 136. The forms are the exact
// ones the partner uses on their own Business tab; the `admin` prop swaps
// every save onto the admin_add_* / admin_set_* RPCs. Mirrors the data each
// partner `new/<kind>/page.tsx` loads (prefilled area, default island,
// commission) so an admin sees the same starting point the partner would.

export const dynamic = "force-dynamic";

const KINDS = ["activity", "vehicle", "car", "stay", "event", "trip", "sailing", "community"] as const;
type Kind = (typeof KINDS)[number];

export default async function AdminAddListingPage({
  params,
}: {
  params: Promise<{ id: string; kind: string }>;
}) {
  const { id, kind } = await params;
  if (!KINDS.includes(kind as Kind)) notFound();

  const partner = await getPartner(id);
  if (!partner) notFound();

  const backHref = `/admin/partners/${id}`;
  const k = kind as Kind;
  let form: React.ReactNode = null;

  if (k === "activity") {
    form = <ActivityForm admin backHref={backHref} partnerId={id} />;
  } else if (k === "vehicle") {
    const business = await getOwnBusiness(id);
    form = (
      <VehicleForm
        admin
        backHref={backHref}
        partnerId={id}
        initialArea={business?.area ?? ""}
        initialMapsUrl={business?.mapsUrl ?? ""}
      />
    );
  } else if (k === "car") {
    form = (
      <CarForm
        admin
        backHref={backHref}
        partnerId={id}
        commissionBps={partner.commissionBps ?? CAB_COMMISSION_BPS_FALLBACK}
      />
    );
  } else if (k === "stay") {
    form = <StayWizard admin backHref={backHref} partnerId={id} />;
  } else if (k === "event") {
    const business = await getOwnBusiness(id);
    form = (
      <EventForm
        admin
        backHref={backHref}
        partnerId={id}
        defaultIslandSlug={business?.islandSlug ?? ""}
      />
    );
  } else if (k === "trip") {
    form = <TripForm admin backHref={backHref} partnerId={id} />;
  } else if (k === "sailing") {
    form = <SailingForm admin backHref={backHref} partnerId={id} />;
  } else {
    const business = await getOwnBusiness(id);
    form = (
      <CommunityForm
        admin
        backHref={backHref}
        partnerId={id}
        defaultIslandSlug={business?.islandSlug ?? ""}
      />
    );
  }

  return (
    <div className="mx-auto max-w-[560px]">
      <Link
        href={`/admin/partners/${id}/add`}
        className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] font-bold text-muted hover:text-ink"
      >
        <BackIcon size={15} />
        Pick a different kind
      </Link>
      <div className="rounded-2xl border border-line bg-surface p-5">
        <p className="mb-3 rounded-xl border border-brandsoft bg-brandsoft px-3.5 py-2.5 text-[12px] font-semibold text-brand">
          Adding for {partner.name}. It goes under &ldquo;Waiting&rdquo; until you approve it.
        </p>
        {form}
      </div>
    </div>
  );
}
