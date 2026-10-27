import { redirect } from "next/navigation";
import { getPartnerSession } from "@/lib/partner-auth";
import { getTodayArrivals } from "@/lib/partner-checkin";
import TodayArrivalsList from "./arrivals-list";
import CheckInForm from "./check-in-form";

export default async function PartnerCheckInPage() {
  const session = await getPartnerSession();
  if (!session) redirect("/partner/login");

  const arrivals = await getTodayArrivals();

  return (
    <>
      <h2 className="font-display text-[20px] font-bold tracking-tight">Check in</h2>
      <p className="mt-0.5 text-[12px] font-medium text-muted">
        Tap someone in from today&rsquo;s list, or use the code box for a walk-in.
      </p>

      <TodayArrivalsList arrivals={arrivals} />

      <div className="mt-8 border-t border-hairline pt-6">
        <h3 className="text-[14px] font-bold">By reference or ticket code</h3>
        <p className="mt-0.5 text-[12px] font-medium text-muted">
          For a booking that isn&rsquo;t today, or a code read off a screen.
        </p>
        <CheckInForm />
      </div>
    </>
  );
}
