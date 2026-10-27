import { notFound, redirect } from "next/navigation";
import { getBroadcastCampaign } from "@/lib/admin-broadcasts";
import { recipientKindLabel } from "@/lib/partner-kind";
import { PageHeader } from "../../../admin-ui";
import BroadcastEditorView from "./broadcast-editor-view";

export const dynamic = "force-dynamic";

export default async function AdminBroadcastEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const campaign = await getBroadcastCampaign(id);
  if (!campaign) notFound();
  // The welcome template shouldn't be edited/sent through this generic
  // one-off editor — it needs {{partner_name}} substitution and idempotent
  // backfill semantics this page doesn't have. Its own editor is at
  // /broadcasts/welcome; listBroadcastCampaigns() already keeps it off the
  // list page, this is the belt-and-braces check for a direct link.
  if (campaign.isWelcomeTemplate) redirect("/admin/communications/broadcasts/welcome");

  return (
    <>
      <PageHeader
        title={campaign.name}
        subtitle={
          campaign.status === "sent"
            ? `Sent to ${campaign.recipientsSent} — ${recipientKindLabel(campaign.recipientKind).toLowerCase()} — sent campaigns can't be edited or re-sent.`
            : "Paste or write the HTML for this email. Preview and send a test before it goes out."
        }
      />
      <BroadcastEditorView campaign={campaign} />
    </>
  );
}
