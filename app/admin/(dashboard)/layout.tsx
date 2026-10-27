import { redirect } from "next/navigation";
import { getAdminAuthState } from "@/lib/admin-auth";
import { countsWaiting } from "@/lib/admin-review";
import AdminHeader from "./admin-header";
import AdminNav from "./admin-nav";
import AdminSidebar from "./admin-sidebar";

// The guard for every screen a signed-in admin sees. Sits in its own route
// group so /admin/login and /admin/not-linked never pass through it — same
// reasoning as the partner dashboard layout.
//
// The shell changed shape this round. It used to be the partner app's
// phone layout with a narrower column: a 560px centre, a top header, two
// tabs. This console is desktop-first — a fixed 248px rail, a wide content
// well, and the phone layout kept as a fallback rather than the default —
// because reviewing a licence document, comparing a month of bookings
// across operators, or scanning revenue by partner are all desk jobs.
//
// The waiting counts are read once, here, and handed to both navs. Doing it
// in the layout rather than in each nav means the badge on "Partners" is the
// same number the Overview tile shows, always, and one query answers both.
export default async function AdminDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const state = await getAdminAuthState();
  if (state.status === "signed-out") redirect("/admin/login");
  if (state.status === "not-admin") redirect("/admin/not-linked");

  const counts = await countsWaiting();

  return (
    <div className="min-h-screen bg-ground">
      <AdminSidebar email={state.session.email} role={state.session.role} counts={counts} />
      <AdminHeader />

      {/* md:pl matches the rail's width; the rail is fixed, so the content
          well has to make room for it itself. pb on mobile clears the
          bottom tab strip. */}
      <div className="md:pl-[248px]">
        <main className="mx-auto max-w-[1440px] px-5 pt-5 pb-24 md:px-8 md:pt-8 md:pb-12">
          {children}
        </main>
      </div>

      <AdminNav role={state.session.role} counts={counts} />
    </div>
  );
}
