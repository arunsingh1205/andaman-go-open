import { redirect } from "next/navigation";
import { getOpsAuthState } from "@/lib/ops-auth";

// The guard for every screen a signed-in, ops-linked user sees. Same shape
// as app/admin/(dashboard)/layout.tsx: sits above every onboarding route so
// /ops/login and /ops/not-linked, both reached by someone who isn't a
// working ops user yet, never pass through it and never redirect-loop.
export default async function OpsPartnerOnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const state = await getOpsAuthState();
  if (state.status === "signed-out") redirect("/ops/login");
  if (state.status === "not-ops") redirect("/ops/not-linked");

  return (
    <div className="mx-auto max-w-[560px] px-5 py-8 md:px-8">
      {children}
    </div>
  );
}
