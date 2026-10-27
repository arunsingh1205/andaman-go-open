import { redirect } from "next/navigation";
import { getPartnerSession } from "@/lib/partner-auth";
import { getPartnerEarnings } from "@/lib/partner-earnings";
import { getPayoutAccount } from "@/lib/partner-payouts";
import EarningsView from "./earnings-view";

export default async function PartnerEarningsPage() {
  const session = await getPartnerSession();
  if (!session) redirect("/partner/login");
  if (session.role !== "owner") redirect("/partner/dashboard");

  const [earnings, payoutAccount] = await Promise.all([
    getPartnerEarnings(),
    getPayoutAccount(session.partnerId),
  ]);

  return (
    <>
      <h2 className="font-display text-[20px] font-bold tracking-tight">Earnings</h2>
      <p className="mt-0.5 text-[12px] font-medium text-muted">
        Checked-in bookings, split into what you&rsquo;re owed and Andaman Go&rsquo;s commission.
        Not a payment tracker — nothing has paid out yet.
      </p>

      <EarningsView earnings={earnings} payoutAccount={payoutAccount} />
    </>
  );
}
