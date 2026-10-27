"use client";

// The feed. Opening this screen is what "reads" it: on mount we stamp every
// unread notification seen and refresh the layout so the bell badge clears —
// but the rows that WERE unread stay highlighted for this visit (snapshot
// held in state), so the partner can still see what's new since last time.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { markNotificationsRead } from "@/lib/partner-actions";
import type { PartnerNotification } from "@/lib/partner-notifications";
import { NotificationRow } from "../notification-row";
import { BellIcon } from "@/app/icons";

export default function NotificationsView({
  notifications,
}: {
  notifications: PartnerNotification[];
}) {
  const router = useRouter();

  // Which rows were unread when this screen first opened — frozen in state
  // (lazy init runs once), so the "new" treatment survives the refresh that
  // follows marking them read.
  const [wasUnread] = useState(
    () => new Set(notifications.filter((n) => !n.read).map((n) => n.id)),
  );

  useEffect(() => {
    if (wasUnread.size === 0) return;
    let cancelled = false;
    void markNotificationsRead().then(() => {
      if (!cancelled) router.refresh();
    });
    return () => {
      cancelled = true;
    };
    // Run once, on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (notifications.length === 0) {
    return (
      <div className="mt-12 flex flex-col items-center text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-ground text-muted">
          <BellIcon size={22} />
        </span>
        <p className="mt-3 text-[13.5px] font-medium text-muted">
          Nothing yet. New bookings and changes show up here.
        </p>
      </div>
    );
  }

  return (
    <ul className="mt-5 flex flex-col gap-2 desk:max-w-2xl">
      {notifications.map((n) => (
        <li key={n.id}>
          <NotificationRow notification={n} fresh={wasUnread.has(n.id)} />
        </li>
      ))}
    </ul>
  );
}
