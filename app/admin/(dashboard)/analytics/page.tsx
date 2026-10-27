import { getTraffic } from "@/lib/admin-traffic";
import TrafficView from "./traffic-view";

// Who is visiting and where they come from. Open to staff as well as the
// owner — nothing here is money. The database (admin_traffic, 155) is the
// real gate.

export const dynamic = "force-dynamic";

export default async function AdminAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const { days } = await searchParams;
  const n = [7, 30, 90].includes(Number(days)) ? Number(days) : 30;
  return <TrafficView data={await getTraffic(n)} />;
}
