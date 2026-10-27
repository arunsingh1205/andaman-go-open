import Link from "next/link";
import type { PartnerNotification } from "@/lib/partner-notifications";
import { notificationHref, type PartnerNotificationKind } from "@/lib/partner-notification-kinds";
import { ChatIcon, ShieldIcon, StarIcon, StormIcon, TicketIcon } from "@/app/icons";

export const KIND_ICON: Record<PartnerNotificationKind, typeof TicketIcon> = {
  booking_new: TicketIcon,
  booking_cancelled: StormIcon,
  booking_disrupted: StormIcon,
  booking_message: ChatIcon,
  review: StarIcon,
  support: ShieldIcon,
};

/** One notification row — shared by the full Notifications page and the
 *  header's quick-glance dropdown, so the two never drift into two ideas of
 *  what a notification looks like. `compact` trims it down for the dropdown. */
export function NotificationRow({
  notification: n,
  fresh,
  compact = false,
  onNavigate,
}: {
  notification: PartnerNotification;
  fresh: boolean;
  compact?: boolean;
  onNavigate?: () => void;
}) {
  const Icon = KIND_ICON[n.kind] ?? TicketIcon;
  const href = notificationHref(n.kind, n.itemId);
  const warn = n.kind === "booking_cancelled" || n.kind === "booking_disrupted";

  const inner = (
    <>
      <span
        className={`flex shrink-0 items-center justify-center rounded-xl ${
          compact ? "h-9 w-9" : "h-11 w-11 rounded-[13px] desk:h-10 desk:w-10 desk:rounded-xl"
        } ${warn ? "bg-sandsoft text-warn" : "bg-brandsoft text-brand"}`}
      >
        <Icon size={compact ? 16 : 18} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className={`truncate leading-tight font-bold ${compact ? "text-[12.5px]" : "text-[13.5px]"}`}>
            {n.title}
          </p>
          {fresh && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />}
        </div>
        <p
          className={`mt-0.5 leading-snug font-medium text-muted ${compact ? "line-clamp-1 text-[11.5px]" : "text-[12px]"}`}
        >
          {n.body}
        </p>
        <p className="mt-1 text-[11px] font-semibold text-muted">{n.agoLabel}</p>
      </div>
    </>
  );

  const className = `flex items-start gap-3 border ${
    compact ? "rounded-xl p-2.5" : "rounded-[18px] p-4 desk:rounded-2xl desk:p-3.5"
  } ${fresh ? "border-line bg-brandsoft" : "border-line bg-surface"}`;

  if (href) {
    return (
      <Link href={href} className={className} onClick={onNavigate}>
        {inner}
      </Link>
    );
  }
  return <div className={className}>{inner}</div>;
}
