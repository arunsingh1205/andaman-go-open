import { redirect } from "next/navigation";
import { getPartnerSession } from "@/lib/partner-auth";
import { getPartnerDashboard, istGreeting } from "@/lib/partner-dashboard";
import { getPartnerOnboarding } from "@/lib/partner-onboarding";
import DashboardView from "./dashboard-view";

export default async function PartnerDashboardPage() {
  const session = await getPartnerSession();
  if (!session) redirect("/partner/login");

  const [dashboard, onboarding] = await Promise.all([
    getPartnerDashboard(),
    // The checklist is the owner's job — a staff member can't act on any of it.
    session.role === "owner" ? getPartnerOnboarding(session.partnerId) : Promise.resolve(null),
  ]);

  return (
    <DashboardView
      partnerName={session.partnerName}
      greeting={istGreeting()}
      dashboard={dashboard}
      onboarding={onboarding && !onboarding.complete ? onboarding : null}
      canAddListing={session.role === "owner"}
    />
  );
}
