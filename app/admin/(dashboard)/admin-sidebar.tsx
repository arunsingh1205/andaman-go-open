"use client";

// The desktop rail. Unlike the partner app — where the sidebar is the
// second-class citizen that appears once there's room — this console is
// desktop-first: nobody reviews a licence document or scans a month of
// bookings on a phone. The rail is the primary navigation, and the tab strip
// in AdminNav is the fallback for the rare phone visit.
//
// Fixed rather than scrolling with the page, so the nav (and the counts of
// what's waiting) stay put while a long bookings table scrolls past.

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { signOutAdmin } from "@/lib/admin-signout";
import { ADMIN_TABS, type WaitingCounts } from "./admin-nav-tabs";
import { LogoutIcon } from "@/app/icons";

export default function AdminSidebar({
  email,
  role,
  counts,
}: {
  email: string | null;
  role: "owner" | "staff";
  counts: WaitingCounts;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const tabs = ADMIN_TABS.filter((t) => !t.ownerOnly || role === "owner");

  const signOut = async () => {
    if (busy) return;
    setBusy(true);
    await signOutAdmin();
    router.replace("/admin/login");
  };

  return (
    <aside className="hidden w-[248px] shrink-0 border-r border-line bg-surface md:fixed md:inset-y-0 md:left-0 md:flex md:flex-col">
      <div className="flex items-center gap-3 border-b border-hairline px-5 py-5">
        <Image
          sizes="40px"
          src="/brand/icon-192.png"
          alt=""
          width={192}
          height={192}
          className="h-10 w-10 shrink-0 rounded-xl"
        />
        <div className="min-w-0">
          <p className="font-display text-[15px] leading-tight font-bold tracking-tight">
            Andaman Go
          </p>
          <p className="text-[11px] font-bold tracking-wider text-muted uppercase">Admin console</p>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3 py-4">
        {tabs.map(({ href, label, Icon, badge }) => {
          const on = pathname === href || pathname.startsWith(`${href}/`);
          const count = badge ? counts[badge] : 0;
          return (
            <Link
              key={href}
              href={href}
              aria-current={on ? "page" : undefined}
              className={`flex items-center gap-3 rounded-button px-3.5 py-2.5 text-[13.5px] font-bold transition-colors ${
                on ? "bg-brand text-white shadow-card" : "text-muted hover:bg-ground hover:text-ink"
              }`}
            >
              <Icon size={18} />
              <span className="flex-1">{label}</span>
              {count > 0 && (
                <span
                  className={`min-w-[20px] rounded-full px-1.5 py-0.5 text-center text-[11px] font-bold ${
                    on ? "bg-white text-brand" : "bg-sand text-white"
                  }`}
                >
                  {count}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-hairline px-5 py-4">
        <p className="text-[11px] font-bold tracking-wider text-muted uppercase">Signed in as</p>
        <p className="mt-0.5 truncate text-[12.5px] font-bold" title={email ?? undefined}>
          {email ?? "Admin"}
        </p>
        <button
          type="button"
          onClick={signOut}
          disabled={busy}
          className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-xl border border-line text-[12.5px] font-bold text-muted hover:bg-ground disabled:opacity-50"
        >
          <LogoutIcon size={15} />
          {busy ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </aside>
  );
}
