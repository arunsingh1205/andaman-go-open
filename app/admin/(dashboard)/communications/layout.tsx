import { requireOwner } from "@/lib/admin-auth";

// Owner-only (139), same reasoning as revenue/page.tsx: the database's own
// is_admin_owner() gate on broadcast_campaigns is the real enforcement,
// this is the courtesy. One guard here covers every route under
// /admin/communications — the campaign list, an individual campaign
// editor, the welcome template, the first-listing backfill — without
// repeating it in each of those page.tsx files.
export default async function CommunicationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireOwner();
  return <>{children}</>;
}
