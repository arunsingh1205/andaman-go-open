import { redirect } from "next/navigation";
import { getPartnerSession } from "@/lib/partner-auth";
import {
  getOwnBusiness,
  getPartnerListings,
  getRentalHours,
  type RentalHour,
} from "@/lib/partner-register";
import BusinessView from "./business-view";

export default async function PartnerBusinessPage() {
  const session = await getPartnerSession();
  if (!session) redirect("/partner/login");
  if (session.role !== "owner") redirect("/partner/dashboard");

  const business = await getOwnBusiness(session.partnerId);
  if (!business) redirect("/partner/login");

  const listings = await getPartnerListings(session.partnerId);
  const rentalHours: RentalHour[] =
    business.kind === "rental" ? await getRentalHours(session.partnerId) : [];

  return <BusinessView business={business} listings={listings} rentalHours={rentalHours} />;
}
