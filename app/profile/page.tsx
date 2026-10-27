import Link from "next/link";
import { getBookingDays } from "@/lib/my-bookings";
import { type BookingKind } from "@/lib/bookings";
import { getMyPhone, getMyEmail } from "@/lib/profile";
import { prettyPhone } from "@/lib/phone";
import { supabaseServer } from "@/lib/supabase-server";
import BottomNav from "@/app/bottom-nav";
import {
  CarIcon,
  ChevronIcon,
  DiveIcon,
  FerryIcon,
  MusicIcon,
  BedIcon,
  PinIcon,
  ScooterIcon,
  UserIcon,
} from "@/app/icons";
import ProfileSettings from "./profile-settings";
import ContactRows from "./contact-rows";
import AccountRow from "./account-row";

// Every visitor hits the same "/profile" URL — the only thing that tells one
// apart from another is the session cookie. Reads Supabase fresh on every
// request — see lib/supabase-server.ts — so this route can't be pre-rendered
// or reused across sessions.
export const dynamic = "force-dynamic";

const KIND_ICON: Record<BookingKind, typeof DiveIcon> = {
  activity: DiveIcon,
  ferry: FerryIcon,
  stay: BedIcon,
  event: MusicIcon,
  cab: CarIcon,
  trip: PinIcon,
  rental: ScooterIcon,
};

export default async function ProfilePage() {
  const supabase = await supabaseServer();
  const [{ data: userData }, days, phone, email] = await Promise.all([
    supabase.auth.getUser(),
    getBookingDays(),
    getMyPhone(),
    getMyEmail(),
  ]);

  const user = userData.user;
  const items = days.flatMap((d) => d.items);
  const stats = {
    bookings: items.length,
    islands: new Set(days.map((d) => d.place)).size,
    upcoming: days.filter((d) => d.when === "upcoming").length,
  };

  const heading = phone ? prettyPhone(phone) : (email ?? "Guest");
  const memberSince = user?.created_at ? new Date(user.created_at).getFullYear() : null;
  const initial = email ? email[0].toUpperCase() : null;

  const nextDay = days.find((d) => d.when === "upcoming");
  const nextItem = nextDay?.items[0];
  const NextIcon = nextItem ? KIND_ICON[nextItem.kind] : DiveIcon;

  return (
    <>
      <div className="sticky top-0 z-30 border-b border-hairline bg-surface">
        <div className="page-well pt-[calc(var(--safe-top)+1.5rem)] pb-5 lg:pt-10 lg:pb-6 lg:flex lg:items-center lg:justify-between">
          <div className="flex items-center gap-3.5">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-brand text-lg font-bold text-white">
              {initial ?? <UserIcon size={24} />}
            </div>
            <div className="min-w-0">
              <h1 className="font-display truncate text-[19px] lg:text-page font-bold tracking-tight">
                {heading}
              </h1>
              {memberSince && (
                <p className="mt-0.5 text-[12px] font-medium text-muted">
                  Member since {memberSince}
                </p>
              )}
            </div>
          </div>

          <div className="mt-4 flex gap-2.5 lg:mt-0 lg:w-[420px]">
            <Stat value={stats.bookings} label="Bookings" />
            <Stat value={stats.islands} label="Islands" />
            <Stat value={stats.upcoming} label="Upcoming" />
          </div>
        </div>
      </div>

      <main className="page-well pt-4 pb-32 lg:pt-8 lg:pb-24 lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-10">
        <div className="lg:[&>:first-child]:mt-0">
        {nextDay && nextItem && (
          <Link
            href="/bookings"
            className="flex items-center gap-3 rounded-[18px] border border-line bg-surface p-4 transition active:scale-[0.985]"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px] bg-brandsoft text-brand">
              <NextIcon size={21} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-semibold text-muted">Next up</p>
              <p className="mt-0.5 truncate text-[14.5px] font-bold">{nextItem.title}</p>
              <p className="mt-0.5 text-[12px] font-medium text-muted">
                {nextDay.label} · {nextItem.timeLabel} · {nextItem.detail}
              </p>
            </div>
            <ChevronIcon size={18} className="shrink-0 text-muted" />
          </Link>
        )}

        <h2 className="mt-7 text-[12px] font-bold tracking-wider text-muted uppercase">
          Contact
        </h2>
        <p className="mt-1 text-[12px] font-medium text-muted">
          Where we send your ticket and any weather updates.
        </p>
        <ContactRows initialPhone={phone} initialEmail={email} />
        </div>

        <div className="lg:[&>:first-child]:mt-0">
        <h2 className="mt-7 text-[12px] font-bold tracking-wider text-muted uppercase">
          Notifications
        </h2>
        <ProfileSettings />

        {/* Anonymous sessions get "Log in", real ones get "Log out" — see
            account-row.tsx for why offering both was misleading. */}
        <AccountRow isAnonymous={user?.is_anonymous !== false} phone={phone} />

        {/* App Store Review Guideline 5.1.1(v): an app that creates accounts
            must let someone start deleting one from inside the app. The page
            this lands on carries both the in-app request button and the
            what-is-kept explanation. */}
        <Link
          href="/delete-account"
          className="mt-3 flex w-full items-center justify-center rounded-2xl border border-line bg-surface py-3.5 text-[13.5px] font-bold text-muted"
        >
          Delete account
        </Link>
        </div>
      </main>

      <BottomNav />
    </>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex-1 rounded-[15px] border border-line bg-ground px-3 py-2.5 text-center lg:py-3">
      <p className="text-[17px] font-bold text-brand">{value}</p>
      <p className="text-[10.5px] font-semibold text-muted">{label}</p>
    </div>
  );
}
