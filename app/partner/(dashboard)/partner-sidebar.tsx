"use client";

// The desktop half of "one codebase, responsive": on a real desktop (`desk:`
// — 1024px+ with a mouse, see globals.css) this is the persistent left rail
// and PartnerNav hides itself; everywhere else, phones and iPads in either
// orientation, it renders nothing and PartnerNav's floating bottom bar
// carries navigation — the app design. Same TABS list either way — one
// source of truth for what a partner can reach, styled twice.
//
// Sticky and full-height, so the tabs stay in reach on a long bookings list
// instead of scrolling away with the page; the rail scrolls on its own if a
// short window can't fit all twelve.
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { tabsFor, type PartnerRole } from "./partner-nav-tabs";

export default function PartnerSidebar({
  partnerName,
  badges,
  role,
}: {
  partnerName: string;
  badges?: Record<string, number>;
  role: PartnerRole;
}) {
  const pathname = usePathname();
  const { all: NAV_TABS } = tabsFor(role);

  return (
    <aside className="no-bar sticky top-0 hidden h-screen w-64 shrink-0 overflow-y-auto border-r border-hairline bg-surface pb-6 desk:flex desk:flex-col">
      <div className="flex items-center gap-3 px-6 pt-7 pb-6">
        <Image
          sizes="40px"
          src="/brand/icon-192.png"
          alt=""
          width={192}
          height={192}
          className="h-10 w-10 shrink-0 rounded-xl"
        />
        <div className="min-w-0">
          <p className="text-[11px] font-bold tracking-wider text-muted uppercase">Partner</p>
          <p className="font-display truncate text-[15px] leading-tight font-bold tracking-tight">
            {partnerName}
          </p>
        </div>
      </div>

      <nav className="flex flex-col gap-1 px-3">
        {NAV_TABS.map(({ href, label, Icon }) => {
          const on = pathname === href || pathname.startsWith(`${href}/`);
          const badge = badges?.[href] ?? 0;
          return (
            <Link
              key={href}
              href={href}
              aria-current={on ? "page" : undefined}
              className={`flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-[13.5px] font-bold ${
                on ? "bg-brandsoft text-brand" : "text-muted hover:bg-ground"
              }`}
            >
              <Icon size={18} />
              {label}
              {badge > 0 && (
                <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-bold text-white">
                  {badge > 9 ? "9+" : badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
