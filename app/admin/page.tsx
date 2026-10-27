import { redirect } from "next/navigation";

// /admin by itself isn't a screen. It used to send you straight to the
// partner review queue, because that was the only thing the console did.
// Now that there are five screens, the landing place is the one that says
// which of them needs you.
export default function AdminIndexPage() {
  redirect("/admin/overview");
}
