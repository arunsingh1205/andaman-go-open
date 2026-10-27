import { redirect } from "next/navigation";
import { getPartnerAuthState } from "@/lib/partner-auth";
import { getArrivalsTodayCount } from "@/lib/partner-bookings";
import { getPartnerNotifications, getUnreadNotificationCount } from "@/lib/partner-notifications";
import NativeBridge from "./native-bridge";
import PartnerHeader from "./partner-header";
import PartnerNav from "./partner-nav";
import PartnerSidebar from "./partner-sidebar";

// The guard for every screen a signed-in, linked partner sees. Sits in its
// own route group so /partner/login and /partner/not-linked — both reached
// by someone who isn't a working partner yet, just for different reasons —
// never pass through it and never redirect-loop.
//
// One codebase, two layouts. Phones and iPads (either orientation) get the
// app design: PartnerHeader is the identity bar and PartnerNav the floating
// tab bar, in a 430px column that opens to 760px on an iPad. On a real
// desktop (`desk:` — 1024px+ with a mouse, see globals.css) PartnerSidebar
// becomes the persistent left rail, PartnerNav hides, and PartnerHeader
// collapses to a slim bar carrying the notification bell and sign-out.
export default async function PartnerDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const state = await getPartnerAuthState();
  if (state.status === "signed-out") redirect("/partner/login");
  if (state.status === "unlinked") redirect("/partner/not-linked");
  if (state.session.mustResetPassword) redirect("/partner/set-password");

  // Every screen wears the unread count on the bell and today's arrivals on
  // the Check-in tab; the notification list itself rides along too, already
  // bounded to 40 rows (partner-notifications.ts), so the header's dropdown
  // opens with data already in hand instead of navigating to a full page and
  // fetching it fresh.
  const [unreadCount, arrivalsToday, notifications] = await Promise.all([
    getUnreadNotificationCount(),
    getArrivalsTodayCount(),
    getPartnerNotifications(),
  ]);
  const navBadges = { "/partner/check-in": arrivalsToday };
  const role = state.session.role;

  return (
    <div className="desk:flex desk:min-h-screen">
      <NativeBridge />
      <PartnerSidebar partnerName={state.session.partnerName} badges={navBadges} role={role} />
      <div className="desk:min-w-0 desk:flex-1">
        <PartnerHeader
          partnerName={state.session.partnerName}
          partnerPhotoPath={state.session.partnerPhotoPath}
          unreadCount={unreadCount}
          notifications={notifications}
          role={role}
          badges={navBadges}
        />
        <PartnerNav badges={navBadges} role={role} />
        {/* pb-28 clears the floating bottom nav bar (its height + its own
            bottom-4 offset + the safe-area inset it pads for) on mobile;
            desktop keeps the old pb-12 since PartnerSidebar owns nav there. */}
        <main className="mx-auto max-w-[430px] px-5 pt-4 pb-28 tablet:max-w-[760px] tablet:px-8 desk:max-w-6xl desk:px-8 desk:pt-6 desk:pb-12">
          {children}
        </main>
      </div>
    </div>
  );
}
