import { getPartnerNotifications } from "@/lib/partner-notifications";
import NotificationsView from "./notifications-view";

export default async function PartnerNotificationsPage() {
  const notifications = await getPartnerNotifications();

  return (
    <>
      <h2 className="font-display text-[20px] font-bold tracking-tight">Notifications</h2>
      <p className="mt-0.5 text-[12px] font-medium text-muted">
        New bookings, cancellations, and anything else worth a look.
      </p>

      <NotificationsView notifications={notifications} />
    </>
  );
}
