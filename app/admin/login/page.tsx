import { redirect } from "next/navigation";
import { getAdminAuthState } from "@/lib/admin-auth";
import AdminLoginForm from "./login-form";

export default async function AdminLoginPage() {
  const state = await getAdminAuthState();
  if (state.status === "admin") redirect("/admin/partners");
  if (state.status === "not-admin") redirect("/admin/not-linked");

  return <AdminLoginForm />;
}
