import { listSupportThreads } from "@/lib/admin-support";
import SupportView from "./support-view";

// Every conversation a partner has opened with Andaman Go (030), newest
// activity first.

export const dynamic = "force-dynamic";

export default async function AdminSupportPage() {
  const threads = await listSupportThreads();
  return <SupportView threads={threads} />;
}
