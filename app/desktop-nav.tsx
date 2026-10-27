"use client";

// The traveller app's top navbar — the desktop half of the bottom tab bar.
//
// Below `lg` this renders nothing visible (BottomNav carries navigation on
// phones); from `lg` up it is a sticky bar and BottomNav hides itself. Same
// destinations either way, styled twice, so a route added to one belongs in
// the other.
//
// It lives in the root layout (like location-bootstrap.tsx) and picks its
// screens by pathname rather than by route group, so it needs no folder moves
// and never appears on the marketing page, /partner, /admin, /ops or the legal
// pages, which each have their own chrome.

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ISLANDS, useIsland } from "@/lib/island-context";
import { ChevronIcon, PinIcon, SearchIcon, UserIcon, CheckIcon } from "./icons";

const TRAVELLER_PREFIXES = [
  "/explore",
  "/activities",
  "/stays",
  "/ferry",
  "/cabs",
  "/scooty",
  "/events",
  "/trips",
  "/community",
  "/search",
  "/bookings",
  "/booked",
  "/profile",
  "/help",
  "/plan",
  "/offers",
];

const LINKS = [
  { label: "Explore", href: "/explore" },
  { label: "Offers", href: "/offers" },
  { label: "Bookings", href: "/bookings" },
  { label: "Help", href: "/help" },
];

// Every browsing screen (activities, stays, ferries…) is "Explore" as far as
// the navbar is concerned; only the account-ish destinations own their own tab.
const OWN_TABS = ["/bookings", "/booked", "/help", "/profile", "/offers"];

function IslandMenu() {
  const { island, setIslandId } = useIsland();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="focus-ring flex h-10 items-center gap-2 rounded-full border border-line bg-surface pr-3 pl-3.5 text-[13px] font-semibold text-ink transition hover:border-brand/40"
      >
        <PinIcon size={15} className="shrink-0 text-brand" />
        {island.name}
        <ChevronIcon
          size={15}
          className={`shrink-0 text-muted transition ${open ? "-rotate-90" : "rotate-90"}`}
        />
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close island menu"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <ul
            role="listbox"
            aria-label="Island"
            className="absolute top-12 right-0 z-50 w-64 rounded-panel border border-line bg-surface p-1.5 shadow-float"
          >
            {ISLANDS.map((i) => {
              const on = i.id === island.id;
              return (
                <li key={i.id} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={on}
                    onClick={() => {
                      setIslandId(i.id);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center gap-3 rounded-control px-3 py-2.5 text-left transition ${
                      on ? "bg-brandsoft text-brand" : "hover:bg-ground"
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] font-bold">{i.name}</span>
                      <span className="block text-[11.5px] font-medium text-muted">
                        {i.former}
                      </span>
                    </span>
                    {on && <CheckIcon size={16} className="shrink-0" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

export default function DesktopNav() {
  const pathname = usePathname() ?? "";
  const onTravellerScreen = TRAVELLER_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  if (!onTravellerScreen) return null;

  const exploreActive = !OWN_TABS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const profileActive = pathname === "/profile";
  // The search screen has its own large input; a second search box beside it is noise.
  const onSearch = pathname === "/search" || pathname.startsWith("/search/");

  // z-40, one above the z-30 sticky headers pages render below it — level
  // with them, the later page header painted over the island menu.
  return (
    <header className="sticky top-0 z-40 hidden border-b border-line bg-surface/95 backdrop-blur lg:block">
      <nav
        aria-label="Main"
        className="page-well flex items-center gap-6"
        style={{ height: "var(--nav-h)" }}
      >
        <Link href="/explore" aria-label="Andaman Go — home" className="focus-ring shrink-0 rounded">
          <Image
            sizes="144px"
            src="/brand/andaman-go-light-mode.png"
            alt="Andaman Go"
            width={1600}
            height={234}
            priority
            className="h-[21px] w-auto"
          />
        </Link>

        {!onSearch && (
        <Link
          href="/search"
          className="focus-ring flex h-11 min-w-0 max-w-[440px] flex-1 items-center gap-2.5 rounded-full border border-line bg-ground px-4 text-muted transition hover:border-brand/40 hover:bg-surface"
        >
          <SearchIcon size={17} className="shrink-0" />
          <span className="truncate text-[13.5px] font-medium">
            Search activities, tables, trips
          </span>
        </Link>
        )}

        <div className="ml-auto flex items-center gap-1">
          {LINKS.map(({ label, href }) => {
            const on = href === "/explore" ? exploreActive : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={on ? "page" : undefined}
                className={`focus-ring rounded-full px-4 py-2 text-[13.5px] font-bold transition ${
                  on ? "bg-brandsoft text-brand" : "text-muted hover:bg-ground hover:text-ink"
                }`}
              >
                {label}
              </Link>
            );
          })}
        </div>

        <IslandMenu />

        <Link
          href="/profile"
          aria-label="Profile"
          aria-current={profileActive ? "page" : undefined}
          className={`focus-ring flex h-10 w-10 shrink-0 items-center justify-center rounded-control border transition ${
            profileActive
              ? "border-brand bg-brand text-white"
              : "border-line text-brand hover:border-brand/40"
          }`}
        >
          <UserIcon size={19} />
        </Link>
      </nav>
    </header>
  );
}
