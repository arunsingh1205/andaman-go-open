import Link from "next/link";
import { listBroadcastCampaigns } from "@/lib/admin-broadcasts";
import { PageHeader } from "../../admin-ui";
import BroadcastsListView from "./broadcasts-list-view";

export const dynamic = "force-dynamic";

export default async function AdminBroadcastsPage() {
  const campaigns = await listBroadcastCampaigns();

  return (
    <>
      <PageHeader
        title="Broadcasts"
        subtitle="One-off HTML emails you write yourself, sent to every partner. Not automated — you compose, preview and send each one by hand."
      >
        <Link
          href="/admin/communications/broadcasts/welcome"
          className="h-10 rounded-xl border border-line bg-surface px-4 text-[12.5px] font-bold text-brand leading-10"
        >
          Partner welcome email
        </Link>
        <Link
          href="/admin/communications/broadcasts/first-listing"
          className="h-10 rounded-xl border border-line bg-surface px-4 text-[12.5px] font-bold text-brand leading-10"
        >
          First-listing email
        </Link>
      </PageHeader>
      <BroadcastsListView campaigns={campaigns} />
    </>
  );
}
