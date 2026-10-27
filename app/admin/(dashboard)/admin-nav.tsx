"use client";

// The phone fallback. Below the md breakpoint the sidebar is gone, so
// navigation moves to a fixed strip at the bottom — thumb-reachable, the
// same shape the partner app uses.
//
// The strip only ever holds the four `primary` tabs plus a fifth "More"
// button — this console started at five tabs total and grew to eleven as
// Cab rates, Reviews, Support, Revenue, Settlements, Communications and
// Staff were added over time, well past what a phone width can hold in one
// row. Everything past the primary four lives in the sheet the "More"
// button opens, the same bottom-sheet shape plan-banner.tsx uses elsewhere
// in the app.

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ADMIN_TABS, type WaitingCounts } from "./admin-nav-tabs";
import { MoreIcon, CloseIcon } from "@/app/icons";

export default function AdminNav({
  role,
  counts,
}: {
  role: "owner" | "staff";
  counts: WaitingCounts;
}) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const tabs = ADMIN_TABS.filter((t) => !t.ownerOnly || role === "owner");
  const primaryTabs = tabs.filter((t) => t.primary);
  const moreTabs = tabs.filter((t) => !t.primary);

  const isOn = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const moreOn = moreTabs.some((t) => isOn(t.href));
  const moreCount = moreTabs.reduce((sum, t) => sum + (t.badge ? counts[t.badge] : 0), 0);

  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
        <div className="flex">
          {primaryTabs.map(({ href, label, Icon, badge }) => {
            const on = isOn(href);
            const count = badge ? counts[badge] : 0;
            return (
              <Link
                key={href}
                href={href}
                aria-current={on ? "page" : undefined}
                className={`relative flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[10px] font-bold ${
                  on ? "text-brand" : "text-navmuted"
                }`}
              >
                <span
                  className={`relative flex h-8 w-11 items-center justify-center rounded-button transition-colors ${
                    on ? "bg-brandsoft" : ""
                  }`}
                >
                  <Icon size={19} />
                  {count > 0 && (
                    <span className="absolute -top-1 right-1.5 min-w-[15px] rounded-full bg-sand px-1 text-center text-[9px] leading-[15px] font-bold text-white">
                      {count}
                    </span>
                  )}
                </span>
                {label}
              </Link>
            );
          })}

          {moreTabs.length > 0 && (
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-haspopup="true"
              aria-expanded={moreOpen}
              className={`relative flex flex-1 flex-col items-center justify-center gap-1 py-2.5 text-[10px] font-bold ${
                moreOn ? "text-brand" : "text-navmuted"
              }`}
            >
              <span
                className={`relative flex h-8 w-11 items-center justify-center rounded-button transition-colors ${
                  moreOn ? "bg-brandsoft" : ""
                }`}
              >
                <MoreIcon size={19} />
                {moreCount > 0 && (
                  <span className="absolute -top-1 right-1.5 min-w-[15px] rounded-full bg-sand px-1 text-center text-[9px] leading-[15px] font-bold text-white">
                    {moreCount}
                  </span>
                )}
              </span>
              More
            </button>
          )}
        </div>
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center md:hidden">
          <button
            type="button"
            aria-label="Close"
            onClick={() => setMoreOpen(false)}
            className="absolute inset-0 bg-ink/40"
          />

          <div
            role="dialog"
            aria-modal="true"
            className="relative z-10 w-full max-w-[430px] rounded-t-sheet bg-surface pb-[env(safe-area-inset-bottom)]"
          >
            <div className="flex items-center justify-between border-b border-hairline px-5 pt-5 pb-4">
              <h2 className="font-display text-[17px] font-bold tracking-tight">More</h2>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setMoreOpen(false)}
                className="-mt-1 -mr-2 flex h-11 w-11 shrink-0 items-center justify-center text-muted"
              >
                <CloseIcon size={20} />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-1 px-3 py-4">
              {moreTabs.map(({ href, label, Icon, badge }) => {
                const on = isOn(href);
                const count = badge ? counts[badge] : 0;
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setMoreOpen(false)}
                    aria-current={on ? "page" : undefined}
                    className={`relative flex flex-col items-center gap-1.5 rounded-card px-2 py-3.5 text-center text-[11.5px] font-bold ${
                      on ? "bg-brandsoft text-brand" : "text-ink"
                    }`}
                  >
                    <span className="relative">
                      <Icon size={21} />
                      {count > 0 && (
                        <span className="absolute -top-1.5 -right-2 min-w-[16px] rounded-full bg-sand px-1 text-center text-[10px] leading-4 font-bold text-white">
                          {count}
                        </span>
                      )}
                    </span>
                    {label}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
