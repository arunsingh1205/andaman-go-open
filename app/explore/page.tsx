import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import TripStrip from "../trip-strip";
import IslandPicker from "../island-picker";
import BottomNav from "../bottom-nav";
import PlanBanner from "../plan-banner";
import OffersBanner from "../offers-banner";
import PopularNearby from "../popular-nearby";
import HomeNextBooking from "../home-next-booking";
import { rupees, getActivities } from "@/lib/activities";
import { cheapestPaise, getShops } from "@/lib/rentals";
import { getTrips } from "@/lib/trips";
import { rankFeatured } from "@/lib/featured";
import { currentIslandSlug } from "@/lib/current-island";
import { FERRY_BOOKING_ENABLED } from "@/lib/ferries";
import {
  ScooterIcon,
  FerryIcon,
  DiveIcon,
  BedIcon,
  MusicIcon,
  CarIcon,
  SunSeaIcon,
  HandsIcon,
  SearchIcon,
  UserIcon,
} from "../icons";

type Tile = {
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  sub: string;
  href: string;
};

// Phone: 108px tile with a bare icon, press-to-shrink. Desktop: taller tile, the
// icon sits in a tinted well, and the card lifts on hover.
//
// min-h, not h. A fixed height clipped nothing - it just let the text run out
// of the bottom of the card onto the page background, which is what happened
// on a narrow screen once a subtitle wrapped to two lines ("Free cleanups,
// drives & volunteer days"). The grid stretches items by default, so the two
// tiles in a row still match each other's height; the row simply grows to fit
// the tallest.
//
// The text sits directly under the icon rather than being pushed to the
// bottom edge (justify-between): when one tile in a row had a two-line title
// and its neighbour a one-line one, bottom-anchoring left the two titles
// starting at different heights, with a different gap under each icon.
const tileClass =
  "card-hover flex min-h-[108px] flex-col gap-3 lg:justify-between rounded-card border border-line bg-surface p-3.5 text-left transition active:scale-[0.97] lg:min-h-[148px] lg:p-5 lg:active:scale-100";

// The rental price teaser and the Popular row read Supabase fresh on every
// request — see lib/supabase.ts.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Explore the Andamans — activities, cabs, rentals & stays | Andaman Go",
  description:
    "Pick your island and book it all in one place: scuba and sea walks, cabs, scooter rentals, stays, events and day trips in Port Blair, Havelock and Neil.",
  alternates: { canonical: "/explore" },
};

export default async function Home() {
  const islandSlug = await currentIslandSlug();

  // These three used to run one after another — getShops() blocking before
  // this function could even return, then TripStrip and PopularNearby each
  // firing their own fetches (including PopularNearby re-fetching trips
  // from scratch, duplicating TripStrip's own query) only once React got to
  // rendering the JSX below. None of the three actually depends on either
  // of the others' results, so there was no reason for that to be
  // sequential — together with cutting the duplicate trips fetch, this
  // turned roughly nineteen mostly-sequential Supabase round trips into
  // three fetchers running at once (2026-09-25 launch-time investigation).
  const [shops, trips, activities] = await Promise.all([
    getShops(islandSlug),
    getTrips(islandSlug),
    getActivities(islandSlug),
  ]);

  const fromPaise = shops.length ? Math.min(...shops.map(cheapestPaise)) : null;
  const featured = rankFeatured(activities, trips);

  const tiles: Tile[] = [
    {
      Icon: ScooterIcon,
      title: "Rent a scooty",
      sub: fromPaise !== null ? `From ${rupees(fromPaise)} / day` : "Scooters & bikes by the day",
      href: "/scooty",
    },
    ...(FERRY_BOOKING_ENABLED
      ? [{ Icon: FerryIcon, title: "Book a ferry", sub: "Port Blair · Havelock · Neil", href: "/ferry" }]
      : []),
    { Icon: DiveIcon, title: "Activities", sub: "Scuba, sea walk, snorkel, stargazing", href: "/activities" },
    { Icon: BedIcon, title: "Stays & homestays", sub: "Rooms & properties by the night", href: "/stays" },
    { Icon: MusicIcon, title: "Events & shows", sub: "Music, comedy, theatre, festivals", href: "/events" },
    { Icon: CarIcon, title: "Cab / car", sub: "Airport, one-way, full day", href: "/cabs" },
    {
      Icon: SunSeaIcon,
      title: "Island adventures",
      sub: "Guided day trips with a local host",
      href: "/trips",
    },
    {
      Icon: HandsIcon,
      title: "Community service",
      sub: "Free cleanups, drives & volunteer days",
      href: "/community",
    },
  ];

  return (
    <>
      {/* A plain full-width bar, not a page-well-inset card — see its own
          comment below for why. Sits outside <main> so it isn't subject to
          page-well's max-width/padding-inline at all, and so its own top
          padding (not <main>'s) is what clears the status bar/notch: it's
          the genuine first thing on the page now, not a card floating
          inside main's padding. */}
      <header className="site-header sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-[var(--hdr-line)] bg-[var(--hdr-bg)] px-5 tablet:px-8 pt-[calc(var(--safe-top)+0.75rem)] pb-3 lg:hidden">
        {/* Still an h1 — the lockup carries the name, so the alt text is
            what screen readers and search engines read here. Only one of
            the two is ever rendered; see .logo-on-* in globals.css. */}
        <h1 className="flex">
          <Image
            sizes="123px"
            src="/brand/andaman-go-light-mode.png"
            alt="Andaman Go"
            width={1600}
            height={234}
            priority
            className="logo-on-light h-[18px] w-auto"
          />
          <Image
            sizes="123px"
            src="/brand/andaman-go-dark-mode.png"
            alt="Andaman Go"
            width={1600}
            height={234}
            className="logo-on-dark h-[18px] w-auto"
          />
        </h1>
        <div className="flex items-center gap-2">
          <Link
            href="/search"
            aria-label="Search"
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--hdr-line)] text-[var(--hdr-icon)]"
          >
            <SearchIcon size={19} />
          </Link>
          <Link
            href="/profile"
            aria-label="Profile"
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--hdr-line)] text-[var(--hdr-icon)]"
          >
            <UserIcon size={20} />
          </Link>
        </div>
      </header>

      {/* From `lg` this is a 12-column grid: the heading + sea report on the left,
          Plan my day + Coming up in a right rail, then the tiles and strips at full
          width. Below `lg` every wrapper below is a plain block, so the phone
          layout and its DOM order are exactly what they were. Search moved into
          the header (a compact icon, next to Profile) instead of this full-width
          bar, which is why there's no lg:hidden search row here any more. */}
      <main className="page-well pt-4 pb-32 lg:pt-12 lg:grid lg:grid-cols-12 lg:gap-x-6 lg:pb-24">
        <div className="lg:col-span-8 lg:row-span-2 lg:row-start-1 lg:flex lg:flex-col lg:justify-center">
          <IslandPicker />
        </div>

        <div className="mt-4.5 grid grid-cols-2 gap-3 lg:col-span-12 lg:row-start-3 lg:mt-12 lg:grid-cols-4 lg:gap-4">
          {tiles.map(({ Icon, title, sub, href }) => (
            <Link key={title} href={href} className={tileClass}>
              <span className="flex h-[26px] w-[26px] items-center justify-center text-brand lg:h-11 lg:w-11 lg:rounded-control lg:bg-brandsoft">
                <Icon size={26} className="lg:h-6 lg:w-6" />
              </span>
              <div>
                <p className="text-[15px] font-bold lg:text-[16.5px]">{title}</p>
                <p className="mt-0.5 text-[12px] font-medium text-muted lg:mt-1 lg:text-[13px]">
                  {sub}
                </p>
              </div>
            </Link>
          ))}
        </div>

        <div className="lg:col-span-4 lg:col-start-9 lg:row-start-1 lg:flex lg:flex-col lg:gap-3 lg:self-end">
          <PlanBanner />
          <OffersBanner />
        </div>

        <div className="lg:col-span-12 lg:row-start-4">
          <TripStrip islandSlug={islandSlug} trips={trips} />
        </div>

        <div className="lg:col-span-12 lg:row-start-5">
          <PopularNearby islandSlug={islandSlug} items={featured} />
        </div>

        <div className="lg:col-span-4 lg:col-start-9 lg:row-start-2 lg:self-start">
          <HomeNextBooking />
        </div>
      </main>

      <BottomNav />
    </>
  );
}
