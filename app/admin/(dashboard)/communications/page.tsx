import Link from "next/link";
import { listNotifications } from "@/lib/admin-communications";
import { PageHeader } from "../admin-ui";
import CommunicationsView from "./communications-view";

export const dynamic = "force-dynamic";

export default async function AdminCommunicationsPage() {
  const notifications = await listNotifications({});
  const failed = notifications.filter((n) => n.status === "failed").length;

  return (
    <>
      <PageHeader
        title="Communications"
        subtitle={
          failed === 0
            ? "Every automated send is up to date."
            : `${failed} send${failed === 1 ? "" : "s"} failed — resend below.`
        }
      >
        <Link
          href="/admin/communications/broadcasts"
          className="h-10 rounded-xl bg-brand px-4 text-[12.5px] font-bold text-white leading-10"
        >
          Broadcasts
        </Link>
      </PageHeader>
      <CommunicationsView notifications={notifications} />
    </>
  );
}
