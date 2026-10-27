// One source of truth for what the console has, styled twice: as the desktop
// sidebar rail (AdminSidebar) and as the phone tab strip (AdminNav). Same
// list either way, the same reason the partner app splits its NAV_TABS out.
//
// `badge` names which waiting-count sits on this item, so the sidebar can
// show "3" next to Partners without either nav component knowing how that
// number is worked out.

import {
  ChatIcon,
  DashboardIcon,
  LicenceIcon,
  DiveIcon,
  FlagIcon,
  StarIcon,
  TicketIcon,
  EarningsIcon,
  CarIcon,
  GraphIcon,
  MailIcon,
  UserIcon,
  TagIcon,
} from "@/app/icons";

export type AdminTab = {
  href: string;
  label: string;
  Icon: (props: { size?: number; className?: string }) => React.JSX.Element;
  badge?: "partners" | "listings" | "support" | "cabDispatch" | "reports";
  /** Hidden from staff (139) — money-sensitive (Revenue, Settlements) or
   *  reaches outside the business to partners/travellers (Communications),
   *  plus the Staff screen itself. Everything without this flag is exactly
   *  what a staff account can already do via is_admin() in the database —
   *  this only controls what shows up in the nav. */
  ownerOnly?: boolean;
  /** Gets one of the four slots in the phone tab strip. Everything else
   *  lives behind that strip's "More" sheet — eleven items (and rising)
   *  stopped fitting a phone width a while ago. The desktop sidebar is
   *  unaffected; it has the room to just list all of them. */
  primary?: boolean;
};

export const ADMIN_TABS: AdminTab[] = [
  { href: "/admin/overview", label: "Overview", Icon: DashboardIcon, primary: true },
  { href: "/admin/partners", label: "Partners", Icon: LicenceIcon, badge: "partners", primary: true },
  { href: "/admin/listings", label: "Listings", Icon: DiveIcon, badge: "listings", primary: true },
  { href: "/admin/bookings", label: "Bookings", Icon: TicketIcon, badge: "cabDispatch", primary: true },
  { href: "/admin/cab-rates", label: "Cab rates", Icon: CarIcon },
  { href: "/admin/promo-codes", label: "Promo codes", Icon: TagIcon },
  { href: "/admin/reviews", label: "Reviews", Icon: StarIcon },
  { href: "/admin/support", label: "Support", Icon: ChatIcon, badge: "support" },
  { href: "/admin/reports", label: "Reports", Icon: FlagIcon, badge: "reports" },
  { href: "/admin/analytics", label: "Traffic", Icon: GraphIcon },
  { href: "/admin/revenue", label: "Revenue", Icon: EarningsIcon, ownerOnly: true },
  { href: "/admin/settlements", label: "Settlements", Icon: GraphIcon, ownerOnly: true },
  { href: "/admin/communications", label: "Communications", Icon: MailIcon, ownerOnly: true },
  { href: "/admin/staff", label: "Staff", Icon: UserIcon, ownerOnly: true },
];

export type WaitingCounts = {
  partners: number;
  listings: number;
  support: number;
  cabDispatch: number;
  reports: number;
};
