import { redirect } from "next/navigation";
import { getPartnerAuthState } from "@/lib/partner-auth";
import PartnerSignupForm from "./signup-form";

export default async function PartnerSignupPage() {
  const state = await getPartnerAuthState();
  // Already signed in — nothing to sign up for.
  if (state.status === "linked") redirect("/partner/bookings");
  if (state.status === "unlinked") redirect("/partner/not-linked");

  return <PartnerSignupForm />;
}
