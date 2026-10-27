import { redirect } from "next/navigation";

// /partner by itself isn't a screen — it's just the front door. Send whoever
// opens it straight to the Dashboard, the app's new home screen.
export default function PartnerIndexPage() {
  redirect("/partner/dashboard");
}
