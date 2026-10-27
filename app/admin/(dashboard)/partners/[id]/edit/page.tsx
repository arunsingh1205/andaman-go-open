import { notFound } from "next/navigation";
import { getOwnBusiness, getRentalHours } from "@/lib/partner-register";
import PartnerEditView from "./partner-edit-view";

// Fix a business's own profile on their behalf — name, island, address, Maps
// link, cover photo, licence, contact phone, and (for a rental shop) its
// pick-up hours. 075-admin-listing-edits.sql. The partner edits the same
// fields on their own Business tab; this is the admin door to them.

export const dynamic = "force-dynamic";

export default async function AdminPartnerEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const business = await getOwnBusiness(id);
  if (!business) notFound();

  const rentalHours = business.kind === "rental" ? await getRentalHours(id) : [];

  return <PartnerEditView business={business} rentalHours={rentalHours} />;
}
