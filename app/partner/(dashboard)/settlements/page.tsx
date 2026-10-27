import { redirect } from "next/navigation";
import { getPartnerSession } from "@/lib/partner-auth";
import { getMySettlementBatches } from "@/lib/partner-settlements";
import SettlementsView from "./settlements-view";

export const dynamic = "force-dynamic";

export default async function PartnerSettlementsPage() {
  const session = await getPartnerSession();
  if (!session) redirect("/partner/login");
  if (session.role !== "owner") redirect("/partner/dashboard");

  // Every category is eligible now (101) — whichever bookings of yours were
  // paid in full or on a deposit online and have since been delivered (or
  // cancelled but still retained money) show up here once Andaman Go runs
  // the week's settlement.
  const batches = await getMySettlementBatches();
  return <SettlementsView batches={batches} />;
}
