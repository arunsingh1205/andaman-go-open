import { redirect } from "next/navigation";
import { getOpsAuthState } from "@/lib/ops-auth";
import OpsLoginForm from "./login-form";

export default async function OpsLoginPage() {
  const state = await getOpsAuthState();
  if (state.status === "ops") redirect("/ops/partner-onboarding");
  if (state.status === "not-ops") redirect("/ops/not-linked");

  return <OpsLoginForm />;
}
