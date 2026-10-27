import { redirect } from "next/navigation";
import { getPartnerAuthState } from "@/lib/partner-auth";
import PartnerLoginForm from "./login-form";

export default async function PartnerLoginPage() {
  const state = await getPartnerAuthState();
  // Already signed in and linked to a business — no reason to ask again.
  if (state.status === "linked") redirect("/partner/bookings");
  // Signed in (say, just came back from Google) but nobody's linked this
  // account to a business yet — that's a different message, not this form.
  if (state.status === "unlinked") redirect("/partner/not-linked");

  return <PartnerLoginForm />;
}
