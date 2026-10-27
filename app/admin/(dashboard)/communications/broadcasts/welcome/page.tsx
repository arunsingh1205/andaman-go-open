import { getWelcomeCampaign } from "@/lib/admin-broadcasts";
import { PageHeader } from "../../../admin-ui";
import WelcomeCampaignView from "./welcome-campaign-view";

export const dynamic = "force-dynamic";

export default async function AdminWelcomeCampaignPage() {
  const campaign = await getWelcomeCampaign();

  return (
    <>
      <PageHeader
        title="Partner welcome email"
        subtitle="Sent automatically to every new partner on signup, and to any current partner who hasn't had one yet."
      />
      <WelcomeCampaignView campaign={campaign} />
    </>
  );
}
