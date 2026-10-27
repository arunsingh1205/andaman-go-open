import { redirect } from "next/navigation";
import { getPartnerAuthState } from "@/lib/partner-auth";
import { getMyPendingInvites } from "@/lib/partner-team";
import RegisterForm from "./register-form";
import InviteAccept from "./invite-accept";
import NotLinkedSignOut from "./not-linked-sign-out";

// Reached by anyone who signs in — usually via Google — without a business
// linked yet. Two things it can offer: accept a team invite someone sent to
// this email (026), or register a business of your own (011).
export default async function PartnerNotLinkedPage() {
  const state = await getPartnerAuthState();
  if (state.status === "signed-out") redirect("/partner/login");
  if (state.status === "linked") redirect("/partner/bookings");

  const invites = await getMyPendingInvites();

  // Someone with an invite still gets the plain padded layout — it's a
  // secondary path, not the onboarding screen the design covers. Nobody
  // with a business to register (no invites) hits RegisterForm's own
  // full-bleed "Step 2 of 2" layout instead, unwrapped.
  if (invites.length === 0) return <RegisterForm askBackupEmail={!state.viaApple} />;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col px-6 py-10">
      <h1 className="font-display text-[22px] font-bold tracking-tight">You&rsquo;ve been invited</h1>
      <p className="mt-2 text-[13.5px] leading-relaxed font-medium text-muted">
        {state.email ? `Signed in as ${state.email}.` : ""}
      </p>
      <InviteAccept invites={invites} />

      <div className="mt-8 border-t border-hairline pt-6">
        <h2 className="font-display text-[16px] font-bold tracking-tight">
          Or register your own business
        </h2>
        <RegisterForm showHero={false} askBackupEmail={!state.viaApple} />
      </div>

      <NotLinkedSignOut />
    </div>
  );
}
