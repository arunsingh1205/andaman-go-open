// The one list of "what's in the partner app" — shared by the mobile bottom
// tab strip (partner-nav.tsx), the mobile menu drawer (partner-header.tsx)
// and the desktop sidebar (partner-sidebar.tsx) so adding a tab later means
// editing one array, not three.
//
// `primary` decides the mobile split: primary tabs get a slot in the bottom
// strip, the rest live in the header's menu drawer alongside Help and Sign
// out. The desktop sidebar shows every tab regardless.
import {
  CalendarIcon,
  DashboardIcon,
  EarningsIcon,
  GearIcon,
  GraphIcon,
  LicenceIcon,
  LinkIcon,
  ListIcon,
  QrIcon,
  RefundIcon,
  StarIcon,
  TicketIcon,
} from "@/app/icons";

// `ownerOnly` tabs are hidden from a staff member — they can work bookings
// and check-ins but have no business seeing earnings or editing listings.
// Settlements/API are only meaningful for a stay partner paid in full online
// (098/099) — every other kind gets an explanatory empty state if they open
// them rather than a hidden tab, since this list isn't otherwise filtered by
// business kind anywhere.
export const NAV_TABS = [
  { href: "/partner/dashboard", label: "Dashboard", Icon: DashboardIcon, primary: true, ownerOnly: false },
  { href: "/partner/bookings", label: "Bookings", Icon: TicketIcon, primary: true, ownerOnly: false },
  { href: "/partner/calendar", label: "Calendar", Icon: CalendarIcon, primary: true, ownerOnly: false },
  { href: "/partner/check-in", label: "Check in", Icon: QrIcon, primary: true, ownerOnly: false },
  { href: "/partner/insights", label: "Insights", Icon: GraphIcon, primary: false, ownerOnly: true },
  { href: "/partner/earnings", label: "Earnings", Icon: EarningsIcon, primary: false, ownerOnly: true },
  { href: "/partner/settlements", label: "Settlements", Icon: RefundIcon, primary: false, ownerOnly: true },
  { href: "/partner/reviews", label: "Reviews", Icon: StarIcon, primary: false, ownerOnly: false },
  { href: "/partner/listings", label: "Listings", Icon: ListIcon, primary: false, ownerOnly: true },
  { href: "/partner/business", label: "Business", Icon: LicenceIcon, primary: false, ownerOnly: true },
  { href: "/partner/api-settings", label: "API access", Icon: LinkIcon, primary: false, ownerOnly: true },
  { href: "/partner/settings", label: "Settings", Icon: GearIcon, primary: false, ownerOnly: true },
] as const;

export type PartnerRole = "owner" | "staff";

export function tabsFor(role: PartnerRole) {
  const visible = NAV_TABS.filter((t) => role === "owner" || !t.ownerOnly);
  return {
    all: visible,
    primary: visible.filter((t) => t.primary),
    more: visible.filter((t) => !t.primary),
  };
}
