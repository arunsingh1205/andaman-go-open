import { notFound } from "next/navigation";
import { getAdminSupportThread } from "@/lib/admin-support";
import ThreadView from "./thread-view";

export const dynamic = "force-dynamic";

export default async function AdminSupportThreadPage({
  params,
}: {
  params: Promise<{ partnerId: string }>;
}) {
  const { partnerId } = await params;
  const thread = await getAdminSupportThread(partnerId);
  if (!thread) notFound();

  return <ThreadView thread={thread} />;
}
