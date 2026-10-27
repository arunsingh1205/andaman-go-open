"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HomeIcon, TicketIcon, ChatIcon, UserIcon } from "./icons";

const items = [
  { label: "Home", Icon: HomeIcon, href: "/explore" },
  { label: "Bookings", Icon: TicketIcon, href: "/bookings" },
  { label: "Help", Icon: ChatIcon, href: "/help" },
  { label: "Profile", Icon: UserIcon, href: "/profile" },
];

export default function BottomNav() {
  const pathname = usePathname();

  return (
    // Two looks, one DOM. On the web this is the full-width slab the site has
    // always had; inside the iOS/Android app it becomes a floating glass
    // capsule. Everything that differs is geometry and material, so the switch
    // lives entirely in globals.css under :root[data-native] — which
    // native-bridge.tsx sets once it knows it is running in the app. Doing it
    // in CSS rather than in React means no hydration mismatch and no flash of
    // the wrong bar on launch.
    //
    // pointer-events-none on the wrapper so that, once the bar is a capsule,
    // the page either side of it stays scrollable and tappable.
    //
    // From `lg` the top navbar (desktop-nav.tsx) takes over.
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 select-none lg:hidden">
      <nav className="glass-nav pointer-events-auto mx-auto flex items-stretch gap-1">
        {items.map(({ label, Icon, href }) => {
          const active = pathname === href;

          return (
            <Link
              key={label}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`glass-nav-item ${active ? "glass-nav-active text-brand" : "text-ink/55"}`}
            >
              <Icon size={21} />
              <span
                className={`text-[10.5px] leading-none tracking-[0.01em] ${
                  active ? "font-bold" : "font-semibold"
                }`}
              >
                {label}
              </span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
