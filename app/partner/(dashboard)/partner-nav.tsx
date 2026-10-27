"use client";

// The mobile bottom tab strip: the primary tabs only. Everything else
// (Insights, Earnings, Reviews, Listings, Business, Settings, Help, Sign
// out) now lives in the one right-side drawer opened from the header's menu
// button — see partner-header.tsx — so this bar doesn't also carry a
// "More" button pointing at a second menu. On a real desktop (`desk:`)
// PartnerSidebar takes over navigation and this hides itself — see
// layout.tsx.
//
// Floats above the content as a dark pill (brand teal), matching the native
// app shell's bottom bar — the active tab gets a brandmint pill behind its
// icon and is the only one that shows a label, so the bar stays compact.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { tabsFor, type PartnerRole } from "./partner-nav-tabs";

export default function PartnerNav({
  badges,
  role,
}: {
  badges?: Record<string, number>;
  role: PartnerRole;
}) {
  const pathname = usePathname();
  const { primary: PRIMARY_TABS } = tabsFor(role);

  const isOn = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div
      className="fixed inset-x-4 bottom-4 z-30 desk:hidden"
      style={{ paddingBottom: "var(--safe-bottom)" }}
    >
      <div className="mx-auto flex max-w-[398px] items-center gap-1 rounded-[28px] bg-brand p-1.5 shadow-lg shadow-black/20">
        {PRIMARY_TABS.map(({ href, label, Icon }) => {
          const on = isOn(href);
          const badge = badges?.[href] ?? 0;
          return (
            <Link
              key={href}
              href={href}
              className={`flex flex-1 flex-col items-center justify-center gap-1 rounded-[20px] py-2.5 text-[10px] font-bold transition-colors ${
                on ? "bg-brandmint text-brand" : "text-white/60"
              }`}
            >
              <span className="relative">
                <Icon size={17} />
                {badge > 0 && (
                  <span className="absolute -top-1.5 -right-2 flex h-[14px] min-w-[14px] items-center justify-center rounded-full bg-warn px-0.5 text-[8px] leading-none font-bold text-white">
                    {badge > 9 ? "9+" : badge}
                  </span>
                )}
              </span>
              {on && label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
