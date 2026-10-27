import { listSettlementBatches } from "@/lib/admin-settlements";
import { requireOwner } from "@/lib/admin-auth";
import { PageHeader } from "../admin-ui";
import SettlementsView from "./settlements-view";

// Owner-only (139) — the database's own is_admin_owner() gate on
// run_settlement/mark_settlement_paid and the admin read policies on
// settlement_batches/settlement_items is the real enforcement; this is the
// courtesy that keeps staff from landing on a page that would just error.

export const dynamic = "force-dynamic";

export default async function AdminSettlementsPage() {
  await requireOwner();

  const batches = await listSettlementBatches("all");
  const pending = batches.filter((b) => b.status === "pending").length;

  return (
    <>
      <PageHeader
        title="Settlements"
        subtitle={
          pending === 0
            ? "Nothing pending payout."
            : `${pending} batch${pending === 1 ? "" : "es"} waiting to be paid out.`
        }
      />
      <SettlementsView batches={batches} />
    </>
  );
}
