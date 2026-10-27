import { redirect } from "next/navigation";
import { getAdminAuthState } from "@/lib/admin-auth";
import AdminNotLinkedSignOut from "./not-linked-sign-out";

// Reached by anyone who signs in without being in the `admins` table.
// Deliberately a dead end, not a registration screen — see admin-auth.ts.
export default async function AdminNotLinkedPage() {
  const state = await getAdminAuthState();
  if (state.status === "signed-out") redirect("/admin/login");
  if (state.status === "admin") redirect("/admin/partners");

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col px-6 py-10">
      <h1 className="font-display text-[22px] font-bold tracking-tight">Not an admin account</h1>
      <p className="mt-2 text-[13.5px] leading-relaxed font-medium text-muted">
        {state.email ? `Signed in as ${state.email}. ` : ""}
        This account isn&apos;t set up to review applications. If this is a mistake, sign in with the
        account Andaman Go uses for admin access instead.
      </p>

      <AdminNotLinkedSignOut />
    </div>
  );
}
