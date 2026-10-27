import { redirect } from "next/navigation";
import { getPartnerSession } from "@/lib/partner-auth";
import { getSupportThread } from "@/lib/partner-support";
import HelpView from "./help-view";

export default async function PartnerHelpPage() {
  const session = await getPartnerSession();
  if (!session) redirect("/partner/login");

  const thread = await getSupportThread(session.partnerId);

  return (
    <>
      <h2 className="font-display text-[20px] font-bold tracking-tight">Help</h2>
      <p className="mt-0.5 text-[12px] font-medium text-muted">
        How the partner app works, and a line straight to Andaman Go.
      </p>

      <HelpView thread={thread} />
    </>
  );
}
