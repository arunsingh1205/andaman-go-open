import { notFound } from "next/navigation";
import Link from "next/link";
import { getPartner } from "@/lib/admin-review";
import {
  BackIcon,
  BedIcon,
  CarIcon,
  ChevronIcon,
  DiveIcon,
  FerryIcon,
  HandsIcon,
  MusicIcon,
  PlanIcon,
  ScooterIcon,
} from "@/app/icons";

// Pick what to add for a business — 136. Every business can take any of the
// eight kinds (the partner's own "What are you adding?" screen offers the same
// list); the chosen form is the partner's own, with its saves swapped onto the
// admin_add_* RPCs. Whatever gets added lands under "Waiting" like a partner's
// own would, ready to approve in one click from the same business page.

export const dynamic = "force-dynamic";

const KINDS = [
  { slug: "activity", label: "Activity", hint: "Scuba, sea walk, snorkelling, jet ski… with departure times", Icon: DiveIcon },
  { slug: "vehicle", label: "Rental vehicle", hint: "A scooter, bike or bicycle — set how many units are in stock", Icon: ScooterIcon },
  { slug: "car", label: "Cab / car", hint: "A yellow-board car for hire", Icon: CarIcon },
  { slug: "stay", label: "Stay / homestay", hint: "Rooms and properties by the night", Icon: BedIcon },
  { slug: "event", label: "Event", hint: "A dated event — DJ or live night, comedy, festival, cruise", Icon: MusicIcon },
  { slug: "trip", label: "Day trip", hint: "A guided trip or excursion", Icon: PlanIcon },
  { slug: "sailing", label: "Ferry sailing", hint: "A scheduled ferry route between islands", Icon: FerryIcon },
  { slug: "community", label: "Community service", hint: "A free cleanup, drive or volunteer day", Icon: HandsIcon },
] as const;

export default async function AdminAddListingPickerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const partner = await getPartner(id);
  if (!partner) notFound();

  return (
    <div className="mx-auto max-w-[560px]">
      <Link
        href={`/admin/partners/${id}`}
        className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] font-bold text-muted hover:text-ink"
      >
        <BackIcon size={15} />
        Back to {partner.name}
      </Link>

      <div className="rounded-2xl border border-line bg-surface p-5">
        <h2 className="font-display text-[20px] font-bold tracking-tight">What are you adding?</h2>
        <p className="mt-1 text-[12.5px] font-medium text-muted">
          Adding on behalf of <strong className="font-bold text-ink">{partner.name}</strong>. It goes
          under &ldquo;Waiting&rdquo; — approve it from the business page once you&apos;ve checked it.
        </p>

        <ul className="mt-5 flex flex-col gap-2.5">
          {KINDS.map(({ slug, label, hint, Icon }) => (
            <li key={slug}>
              <Link
                href={`/admin/partners/${id}/add/${slug}`}
                className="flex items-center gap-3 rounded-[18px] border border-line bg-surface p-4 hover:border-brand"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px] bg-brandsoft text-brand">
                  <Icon size={21} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14.5px] font-bold">{label}</span>
                  <span className="block text-[12px] font-medium text-muted">{hint}</span>
                </span>
                <ChevronIcon size={16} className="shrink-0 text-muted" />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
