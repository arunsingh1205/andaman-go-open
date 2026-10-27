"use client";

// The top bar. On mobile the right-hand button opens one consolidated
// right-side drawer — profile card, every secondary nav item (what used to
// live in the bottom sheet's "More" button) and Settings/Help/Sign out
// (what used to live in a separate account dropdown) all under one roof, so
// a partner isn't hunting between two different menus for "the rest of the
// app." On desktop, PartnerSidebar already shows every nav item in the rail
// and this collapses to a slim bar with a small account dropdown instead —
// still one component, styled two ways by breakpoint.

import { useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOutPartner } from "@/lib/partner-signout";
import { markNotificationsRead } from "@/lib/partner-actions";
import { partnerPhotoUrl } from "@/lib/partner-storage";
import type { PartnerNotification } from "@/lib/partner-notifications";
import { NotificationRow } from "./notification-row";
import { tabsFor, type PartnerRole } from "./partner-nav-tabs";
import { BellIcon, ChevronIcon, CloseIcon, HelpIcon, LogoutIcon, MenuIcon, UserIcon } from "@/app/icons";

export default function PartnerHeader({
  partnerName,
  partnerPhotoPath,
  unreadCount,
  notifications,
  role,
  badges,
}: {
  partnerName: string;
  partnerPhotoPath: string | null;
  unreadCount: number;
  notifications: PartnerNotification[];
  role: PartnerRole;
  badges?: Record<string, number>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  // Which rows were unread the moment the dropdown was opened — captured
  // then, not derived live, so the "new" dot survives the refresh that
  // follows marking them read (same reasoning as the full Notifications
  // page's own wasUnread snapshot).
  const [wasUnread, setWasUnread] = useState<Set<string>>(new Set());
  const { more: MORE_TABS } = tabsFor(role);
  const isOn = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  const toggleNotifications = () => {
    const opening = !notifOpen;
    setNotifOpen(opening);
    setMenuOpen(false);
    if (!opening) return;

    const unread = notifications.filter((n) => !n.read);
    setWasUnread(new Set(unread.map((n) => n.id)));
    if (unread.length > 0) {
      void markNotificationsRead().then(() => router.refresh());
    }
  };

  const initials = partnerName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

  const signOut = async () => {
    if (busy) return;
    setBusy(true);
    await signOutPartner();
    router.replace("/partner/login");
  };

  return (
    <div className="sticky top-0 z-30 border-b border-hairline bg-surface desk:border-b-0 desk:bg-transparent">
      <div className="mx-auto flex max-w-[430px] items-center gap-3 px-5 pt-[calc(var(--safe-top)+1.5rem)] pb-4 tablet:max-w-[760px] tablet:px-8 desk:max-w-none desk:justify-end desk:px-8 desk:pt-6 desk:pb-0">
        <Image
          sizes="40px"
          src="/brand/icon-192.png"
          alt=""
          width={192}
          height={192}
          className="h-10 w-10 shrink-0 rounded-xl desk:hidden"
        />
        <div className="min-w-0 flex-1 desk:hidden">
          <p className="text-[11px] font-bold tracking-wider text-muted uppercase">Partner</p>
          <h1 className="font-display truncate text-[17px] leading-tight font-bold tracking-tight">
            {partnerName}
          </h1>
        </div>

        <div className="relative shrink-0">
          <button
            type="button"
            onClick={toggleNotifications}
            aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
            aria-expanded={notifOpen}
            className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-line text-muted desk:h-9"
          >
            <BellIcon size={18} className="desk:hidden" />
            <BellIcon size={15} className="hidden desk:block" />
            {unreadCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-white">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>

          {notifOpen && (
            <>
              <button
                type="button"
                aria-hidden
                tabIndex={-1}
                onClick={() => setNotifOpen(false)}
                className="fixed inset-0 z-40 cursor-default"
              />
              <div className="fixed inset-x-4 top-[calc(env(safe-area-inset-top)+70px)] z-50 max-h-[70vh] overflow-y-auto rounded-[20px] border border-line bg-surface shadow-lg tablet:absolute tablet:inset-x-auto tablet:top-auto tablet:right-0 tablet:mt-2 tablet:w-96 tablet:max-h-[28rem] desk:absolute desk:inset-x-auto desk:top-auto desk:right-0 desk:mt-2 desk:w-96 desk:max-h-[28rem]">
                <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
                  <p className="text-[13.5px] font-bold">Notifications</p>
                  <button
                    type="button"
                    aria-label="Close notifications"
                    onClick={() => setNotifOpen(false)}
                    className="flex h-7 w-7 items-center justify-center rounded-full text-muted"
                  >
                    <CloseIcon size={14} />
                  </button>
                </div>

                {notifications.length === 0 ? (
                  <p className="px-4 py-8 text-center text-[12.5px] font-medium text-muted">
                    Nothing yet. New bookings and changes show up here.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1.5 p-2">
                    {notifications.slice(0, 10).map((n) => (
                      <li key={n.id}>
                        <NotificationRow
                          notification={n}
                          fresh={wasUnread.has(n.id)}
                          compact
                          onNavigate={() => setNotifOpen(false)}
                        />
                      </li>
                    ))}
                  </ul>
                )}

                <Link
                  href="/partner/notifications"
                  onClick={() => setNotifOpen(false)}
                  className="flex items-center justify-center gap-1 border-t border-hairline py-3 text-[12.5px] font-bold text-brand"
                >
                  See all notifications
                  <ChevronIcon size={13} />
                </Link>
              </div>
            </>
          )}
        </div>

        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => {
              setMenuOpen((v) => !v);
              setNotifOpen(false);
            }}
            aria-label="Menu"
            aria-expanded={menuOpen}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-line text-muted desk:h-9"
          >
            <MenuIcon size={18} className="desk:hidden" />
            <UserIcon size={15} className="hidden desk:block" />
          </button>

          {/* Desktop: a small account dropdown — the sidebar already carries every nav item. */}
          {menuOpen && (
            <>
              <button
                type="button"
                aria-hidden
                tabIndex={-1}
                onClick={() => setMenuOpen(false)}
                className="fixed inset-0 z-40 hidden cursor-default desk:block"
              />
              <div className="absolute right-0 z-50 mt-2 hidden w-44 overflow-hidden rounded-xl border border-line bg-surface shadow-lg desk:block">
                {role === "owner" && (
                  <Link
                    href="/partner/settings"
                    onClick={() => setMenuOpen(false)}
                    className="block px-4 py-3 text-[13px] font-bold text-ink hover:bg-ground"
                  >
                    Settings
                  </Link>
                )}
                <Link
                  href="/partner/help"
                  onClick={() => setMenuOpen(false)}
                  className={`block px-4 py-3 text-[13px] font-bold text-ink hover:bg-ground ${
                    role === "owner" ? "border-t border-hairline" : ""
                  }`}
                >
                  Help
                </Link>
                <button
                  type="button"
                  onClick={signOut}
                  disabled={busy}
                  className="flex w-full items-center gap-2 border-t border-hairline px-4 py-3 text-left text-[13px] font-bold text-ink hover:bg-ground disabled:opacity-50"
                >
                  <LogoutIcon size={15} className="text-muted" />
                  {busy ? "Signing out…" : "Sign out"}
                </button>
              </div>
            </>
          )}

          {/* Mobile: one drawer — profile, every secondary nav item, Help, Sign out.
              Portalled onto <body>, not rendered in place: PartnerNav's bottom
              tab pill is z-30 to this drawer's z-50, which should already put
              the drawer on top in the same stacking context — but on device
              the pill still painted over "Sign out" at the bottom of the
              drawer, the same WebKit fixed-position/stacking quirk the
              traveller app's sign-in sheet hit (see app/sign-in-sheet.tsx).
              A portal sidesteps whatever ancestor is splitting the two into
              different stacking contexts rather than chasing it again. */}
          {menuOpen &&
            createPortal(
              <div className="desk:hidden">
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setMenuOpen(false)}
                className="fixed inset-0 z-40 bg-ink/40"
              />
              <div
                className="fixed inset-y-0 right-0 z-50 flex w-[86%] max-w-[340px] flex-col overflow-y-auto bg-ground pb-6"
                style={{ paddingTop: "max(env(safe-area-inset-top), 20px)" }}
              >
                <div className="flex items-center justify-end px-4 pb-4">
                  <button
                    type="button"
                    aria-label="Close menu"
                    onClick={() => setMenuOpen(false)}
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface text-ink"
                  >
                    <CloseIcon size={16} />
                  </button>
                </div>

                <div className="mx-3 flex items-center gap-3 rounded-[18px] border border-line bg-surface p-3.5">
                  {partnerPhotoPath ? (
                    <Image
                      src={partnerPhotoUrl(partnerPhotoPath)}
                      alt=""
                      width={44}
                      height={44}
                      className="h-11 w-11 shrink-0 rounded-[13px] object-cover"
                    />
                  ) : (
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px] bg-brand text-[14px] font-extrabold text-white">
                      {initials || "?"}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14.5px] font-bold text-ink">{partnerName}</p>
                    <p className="mt-0.5 text-[11.5px] font-semibold text-muted">
                      {role === "owner" ? "Owner" : "Staff"} partner
                    </p>
                  </div>
                </div>

                <nav className="mx-3 mt-3 flex flex-col gap-0.5 rounded-[20px] border border-line bg-surface p-1.5">
                  {MORE_TABS.map(({ href, label, Icon }) => {
                    const on = isOn(href);
                    const badge = badges?.[href] ?? 0;
                    return (
                      <Link
                        key={href}
                        href={href}
                        onClick={() => setMenuOpen(false)}
                        className={`flex items-center gap-3 rounded-[14px] px-2.5 py-2.5 text-[14px] font-bold ${
                          on ? "bg-brandsoft text-brand" : "text-ink"
                        }`}
                      >
                        <span
                          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] shadow-sm shadow-black/5 ${
                            on ? "bg-brand text-white" : "bg-ground text-brand"
                          }`}
                        >
                          <Icon size={17} />
                        </span>
                        <span className="flex-1">{label}</span>
                        {badge > 0 && (
                          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-warn px-1.5 text-[11px] font-bold text-white">
                            {badge > 9 ? "9+" : badge}
                          </span>
                        )}
                        <ChevronIcon size={16} className="shrink-0 text-muted" />
                      </Link>
                    );
                  })}
                  <Link
                    href="/partner/help"
                    onClick={() => setMenuOpen(false)}
                    className={`flex items-center gap-3 rounded-[14px] px-2.5 py-2.5 text-[14px] font-bold ${
                      isOn("/partner/help") ? "bg-brandsoft text-brand" : "text-ink"
                    }`}
                  >
                    <span
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] shadow-sm shadow-black/5 ${
                        isOn("/partner/help") ? "bg-brand text-white" : "bg-ground text-brand"
                      }`}
                    >
                      <HelpIcon size={17} />
                    </span>
                    <span className="flex-1">Help & support</span>
                    <ChevronIcon size={16} className="shrink-0 text-muted" />
                  </Link>
                </nav>

                <div className="mx-3 mt-3 flex items-center gap-3 rounded-[18px] border border-warn/30 bg-surface p-2.5">
                  <button
                    type="button"
                    onClick={signOut}
                    disabled={busy}
                    className="flex w-full items-center gap-3 rounded-[14px] px-1 py-1 text-left text-[14px] font-bold text-warn disabled:opacity-50"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-sandsoft text-warn">
                      <LogoutIcon size={17} />
                    </span>
                    {busy ? "Signing out…" : "Sign out"}
                  </button>
                </div>

                <p className="mt-auto pt-6 text-center text-[11px] font-semibold text-muted">
                  Andaman Go Partner
                </p>
              </div>
              </div>,
              document.body,
            )}
        </div>
      </div>
    </div>
  );
}
