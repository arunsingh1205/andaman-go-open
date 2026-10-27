import { redirect } from "next/navigation";
import { getPartnerSession } from "@/lib/partner-auth";
import { getPartnerInsights } from "@/lib/partner-insights";
import InsightsView from "./insights-view";

export default async function PartnerInsightsPage() {
  const session = await getPartnerSession();
  if (!session) redirect("/partner/login");
  if (session.role !== "owner") redirect("/partner/dashboard");

  const insights = await getPartnerInsights();

  return (
    <>
      <h2 className="font-display text-[20px] font-bold tracking-tight">Insights</h2>
      <p className="mt-0.5 text-[12px] font-medium text-muted">
        How this month is going, and where your bookings come from.
      </p>

      <InsightsView insights={insights} />
    </>
  );
}
