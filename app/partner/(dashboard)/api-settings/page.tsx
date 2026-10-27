import { redirect } from "next/navigation";
import { getPartnerSession } from "@/lib/partner-auth";
import { listMyApiKeys } from "@/lib/partner-api-keys";
import ApiSettingsView from "./api-settings-view";

export const dynamic = "force-dynamic";

export default async function ApiSettingsPage() {
  const session = await getPartnerSession();
  if (!session) redirect("/partner/login");
  if (session.role !== "owner") redirect("/partner/dashboard");

  const keys = await listMyApiKeys();
  return <ApiSettingsView keys={keys} />;
}
