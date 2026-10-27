import { listMessageReports } from "@/lib/admin-reports";
import ReportsView from "./reports-view";

// Every report filed by a traveller or a partner against a booking's
// message thread (152), newest first.

export const dynamic = "force-dynamic";

export default async function AdminReportsPage() {
  const reports = await listMessageReports();
  return <ReportsView reports={reports} />;
}
