import Link from "next/link";
import { redirect } from "next/navigation";
import { getPartnerSession } from "@/lib/partner-auth";
import {
  BackIcon,
  BedIcon,
  CarIcon,
  DiveIcon,
  FerryIcon,
  HandsIcon,
  MusicIcon,
  PlanIcon,
  ScooterIcon,
} from "@/app/icons";

const CATEGORIES = [
  {
    href: "/partner/business/new/activity",
    label: "Activity",
    hint: "Scuba, sea walk, snorkelling, jet ski, banana ride… — set your departure times here too",
    Icon: DiveIcon,
  },
  {
    href: "/partner/business/new/vehicle",
    label: "Rental vehicle",
    hint: "A scooter, bike or bicycle you rent out",
    Icon: ScooterIcon,
  },
  {
    href: "/partner/business/new/car",
    label: "Cab / car",
    hint: "A yellow-board car you drive for hire",
    Icon: CarIcon,
  },
  {
    href: "/partner/business/new/stay",
    label: "Stay / homestay",
    hint: "A room or a whole homestay travellers can book by the night — set rooms, photos and pricing here",
    Icon: BedIcon,
  },
  {
    href: "/partner/business/new/event",
    label: "Event",
    hint: "A dated event — DJ or live night, comedy, theatre, a festival, carnival or dinner cruise",
    Icon: MusicIcon,
  },
  {
    href: "/partner/business/new/trip",
    label: "Day trip",
    hint: "A guided trip or excursion you host",
    Icon: PlanIcon,
  },
  {
    href: "/partner/business/new/sailing",
    label: "Ferry sailing",
    hint: "A scheduled ferry route between islands",
    Icon: FerryIcon,
  },
  {
    href: "/partner/business/new/community",
    label: "Community service",
    hint: "A free activity your community or NGO runs — beach cleanups, drives, volunteer days. People sign up with “I'm interested”.",
    Icon: HandsIcon,
  },
] as const;

export default async function NewListingPage() {
  const session = await getPartnerSession();
  if (!session) redirect("/partner/login");
  if (session.role !== "owner") redirect("/partner/dashboard");

  return (
    <>
      <Link href="/partner/business" className="flex items-center gap-1.5 text-[13px] font-bold text-muted">
        <BackIcon size={14} />
        Business
      </Link>

      <h2 className="font-display mt-3 text-[20px] font-bold tracking-tight">What are you adding?</h2>
      <p className="mt-1 text-[12.5px] font-medium text-muted">
        Add one at a time — each goes to Andaman Go for review before it appears to travellers.
      </p>

      <ul className="mt-5 flex flex-col gap-2.5">
        {CATEGORIES.map(({ href, label, hint, Icon }) => (
          <li key={href}>
            <Link
              href={href}
              className="flex items-center gap-3 rounded-[18px] border border-line bg-surface p-4"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px] bg-brandsoft text-brand">
                <Icon size={21} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[14.5px] font-bold">{label}</p>
                <p className="text-[12px] font-medium text-muted">{hint}</p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
