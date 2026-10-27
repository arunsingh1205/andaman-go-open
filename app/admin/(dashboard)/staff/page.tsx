import { requireOwner, getAdminSession } from "@/lib/admin-auth";
import { listStaff } from "@/lib/admin-staff";
import { PageHeader } from "../admin-ui";
import StaffView from "./staff-view";

// Owner-only (139) — who can get into this console at all, and with how
// much of it. is_admin_owner() gates every RPC lib/admin-staff.ts calls;
// this page-level guard is the courtesy that keeps staff from landing here
// to begin with, same reasoning as revenue/page.tsx and settlements/page.tsx.

export const dynamic = "force-dynamic";

export default async function AdminStaffPage() {
  await requireOwner();

  const [staff, session] = await Promise.all([listStaff(), getAdminSession()]);

  return (
    <>
      <PageHeader
        title="Staff"
        subtitle="Who can get into this console, and with how much of it."
      />
      <StaffView staff={staff} currentUserId={session?.userId ?? null} />
    </>
  );
}
