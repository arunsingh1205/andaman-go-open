import { redirect } from "next/navigation";
import { getPartnerSession } from "@/lib/partner-auth";
import { getPartnerSettings } from "@/lib/partner-settings";
import { getPartnerTeam } from "@/lib/partner-team";
import SettingsView from "./settings-view";

export default async function PartnerSettingsPage() {
  const session = await getPartnerSession();
  if (!session) redirect("/partner/login");
  if (session.role !== "owner") redirect("/partner/dashboard");

  const [settings, team] = await Promise.all([
    getPartnerSettings(session.partnerId),
    getPartnerTeam(session.partnerId),
  ]);

  return <SettingsView partnerName={session.partnerName} settings={settings} team={team} />;
}
