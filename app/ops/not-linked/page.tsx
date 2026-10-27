import { redirect } from "next/navigation";
import { getOpsAuthState } from "@/lib/ops-auth";
import OpsNotLinkedSignOut from "./not-linked-sign-out";

// Reached by anyone who signs in without being in the `ops_users` table.
// Deliberately a dead end, not a registration screen — see ops-auth.ts.
export default async function OpsNotLinkedPage() {
  const state = await getOpsAuthState();
  if (state.status === "signed-out") redirect("/ops/login");
  if (state.status === "ops") redirect("/ops/partner-onboarding");

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col px-6 py-10">
      <h1 className="font-display text-[22px] font-bold tracking-tight">Not an ops account</h1>
      <p className="mt-2 text-[13.5px] leading-relaxed font-medium text-muted">
        {state.email ? `Signed in as ${state.email}. ` : ""}
        This account isn&apos;t set up to onboard partners. If this is a mistake, sign in with the
        account Andaman Go uses for ops access instead.
      </p>

      <OpsNotLinkedSignOut />
    </div>
  );
}
