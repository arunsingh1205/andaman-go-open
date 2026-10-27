import { redirect } from "next/navigation";
import { getPartnerSession } from "@/lib/partner-auth";
import { getPartnerListings } from "@/lib/partner-register";
import ListingsView from "./listings-view";

export default async function PartnerListingsPage() {
  const session = await getPartnerSession();
  if (!session) redirect("/partner/login");
  if (session.role !== "owner") redirect("/partner/dashboard");

  const listings = await getPartnerListings(session.partnerId);

  return <ListingsView listings={listings} />;
}
