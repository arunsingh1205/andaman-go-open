import type { Metadata } from "next";
import { Fragment } from "react";
import Image from "next/image";
import Link from "next/link";
import { qrCode } from "@/lib/qr";
import { SITE_NAME, SITE_URL, absoluteUrl } from "@/lib/seo";
import { BUSINESS } from "./(legal)/legal-meta";
import JsonLd from "./json-ld";
import Motion from "./marketing/motion";
import Journey from "./marketing/journey";
import Phone from "./marketing/phone";
import { SCREENS } from "./marketing/screens";
import {
  DiveIcon,
  FerryIcon,
  BedIcon,
  ScooterIcon,
  CarIcon,
  MusicIcon,
  SunSeaIcon,
  HandsIcon,
} from "./icons";
import s from "./home.module.css";

// The public marketing page. The traveller app itself lives at /explore.
//
// The photographs are ones operators uploaded to their own listings, and every
// phone screen is a capture of the running app — both are kept as files in
// public/marketing/ so the page stays static. The two exceptions are the
// stock-*.webp files (Unsplash licence): Events and Community service have no
// listing photos yet. Swap them for real ones when those listings get some. Nothing here
// asks anyone to sign in: the app books straight through without an account.
export const metadata: Metadata = {
  title: "Andaman Go — book Andaman scuba, snorkelling, cabs, scooters & stays",
  description:
    "Activities, cabs, scooters, stays and island adventures across Port Blair, Havelock and Neil — booked in one place, from operators whose licences we have checked. No account needed, and every booking is a QR ticket scanned on arrival.",
  alternates: { canonical: "/" },
};

// Who runs the site, for a search engine's knowledge panel. The same details
// as the footer and /contact, read from the one place those come from.
const ORGANIZATION = {
  "@type": "TravelAgency",
  "@id": `${SITE_URL}/#organization`,
  name: SITE_NAME,
  url: SITE_URL,
  logo: absoluteUrl("/brand/andaman-go-light-mode.png"),
  image: absoluteUrl("/opengraph-image.png"),
  description:
    "A booking marketplace for activities, cabs, scooter rentals, stays and island day trips in the Andaman Islands, from licence-checked local operators.",
  email: BUSINESS.email,
  telephone: BUSINESS.phoneHref,
  address: {
    "@type": "PostalAddress",
    streetAddress: BUSINESS.addressLines[0],
    addressLocality: "Sri Vijaya Puram (Port Blair)",
    addressRegion: "Andaman and Nicobar Islands",
    postalCode: "744106",
    addressCountry: "IN",
  },
  areaServed: ["Port Blair", "Havelock Island", "Neil Island"],
};

const WEBSITE = {
  "@type": "WebSite",
  "@id": `${SITE_URL}/#website`,
  name: SITE_NAME,
  url: SITE_URL,
  publisher: { "@id": `${SITE_URL}/#organization` },
};

const ROOT_ID = "marketing-root";

const HEADLINE = ["Your", "whole", "Andaman", "trip,", "booked", "in", "minutes."];

// The two rows that drift past under the hero. Names are the listings' own.
const TICKER_A = [
  { src: "dive-reef", name: "Boat Dive", place: "Havelock", shape: "wide" },
  { src: "waterfall", name: "Waterfall Trail", place: "Havelock", shape: "square" },
  { src: "jolly-buoy", name: "Jolly Buoy Island & Wandoor Beach", place: "Port Blair", shape: "wide" },
  { src: "dive-red-pillar", name: "Boat Diving in Red Pillar", place: "Havelock", shape: "square" },
  { src: "secret-beach", name: "Secret Beach", place: "Havelock", shape: "tall" },
  { src: "fishing", name: "Game Fishing", place: "Port Blair", shape: "wide" },
];

const TICKER_B = [
  { src: "sunset-charter", name: "Sunset Private Boat Charter", place: "Port Blair", shape: "wide" },
  { src: "mangrove", name: "Mangrove Walk", place: "Havelock", shape: "square" },
  { src: "dive-tribe-gate", name: "Boat Diving in Tribe Gate", place: "Havelock", shape: "wide" },
  { src: "forest", name: "Forest Trail", place: "Havelock", shape: "tall" },
  { src: "shore-dive", name: "Shore Dive", place: "Havelock", shape: "square" },
  { src: "palms", name: "Intertidal Walk", place: "Havelock", shape: "square" },
];

type Ticker = typeof TICKER_A;

function TickerRow({ items, reverse }: { items: Ticker; reverse?: boolean }) {
  // Rendered twice back to back so the loop has no seam; the copy is hidden
  // from assistive tech.
  return (
    <div className={`${s.tickerRow} ${reverse ? s.tickerReverse : ""}`}>
      <div className={s.tickerTrack}>
        {[0, 1].map((copy) =>
          items.map(({ src, name, place, shape }) => (
            <figure
              key={`${copy}-${src}`}
              className={`${s.tickerCard} ${s[`shape_${shape}`]}`}
              aria-hidden={copy === 1}
            >
              <Image
                src={`/marketing/${src}.webp`}
                alt={copy === 0 ? `${name}, ${place}` : ""}
                fill
                sizes="340px"
                className={s.cover}
              />
              <figcaption className={s.tickerCap}>
                <strong>{name}</strong>
                <span>{place}</span>
              </figcaption>
            </figure>
          )),
        )}
      </div>
    </div>
  );
}

// The ferry tile's little sea. The route is shared between the dotted line
// in the SVG and the path the boat follows in home.module.css (.ferry), so
// the two must be kept identical.
const FERRY_ROUTE = "M90 120 C 122 146, 130 108, 154 92 S 300 152, 346 118";

const WAVES: Array<[number, number]> = [
  [108, 62], [282, 40], [150, 146], [300, 96], [20, 150], [244, 132], [356, 152], [62, 34],
];

function Island({ x, y, name }: { x: number; y: number; name: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <ellipse cx="0" cy="6" rx="36" ry="6" fill="#0A2A30" opacity="0.45" />
      <path d="M-31 5Q-19 -8 0 -8Q19 -8 31 5Z" fill="#E9C893" />
      <path d="M-22 0Q-13 -23 2 -21Q16 -19 22 0Z" fill="#4FB3A4" />
      <path d="M7 -19Q10 -31 8 -41" stroke="#C99A5B" strokeWidth="2.4" strokeLinecap="round" />
      <path
        d="M8 -41Q-2 -47 -8 -40M8 -41Q1 -51 -3 -53M8 -41Q15 -51 21 -47M8 -41Q18 -45 22 -38M8 -41Q9 -51 13 -54"
        stroke="#7FD1C5"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <text x="0" y="24" textAnchor="middle" fontSize="10.5" fontWeight="700" fill="#fff" opacity="0.8">
        {name}
      </text>
    </g>
  );
}

export default function MarketingHome() {
  const qr = qrCode("AG-S868V-A");

  return (
    <div id={ROOT_ID} className={s.page}>
      <JsonLd data={{ "@graph": [ORGANIZATION, WEBSITE] }} />
      <Motion rootId={ROOT_ID} />

      {/* --- nav --- */}
      <header className={s.nav}>
        <nav className={`${s.wrap} ${s.navInner}`} aria-label="Main">
          <Link href="/" className={s.navLogoSlot} aria-label="Andaman Go — home">
            <Image
              sizes="180px"
              src="/brand/andaman-go-light-mode.png"
              alt="Andaman Go"
              width={1600}
              height={234}
              priority
              className={s.navLogo}
            />
          </Link>
          <div className={s.navLinks}>
            <a className={s.navLink} href="#how">How it works</a>
            <a className={s.navLink} href="#book">What you can book</a>
            <a className={s.navLink} href="#operators">Operators</a>
          </div>
          <Link className={s.navCta} href="/explore">
            Open the app
            <Arrow />
          </Link>
        </nav>
      </header>

      <main>
        {/* --- hero --- */}
        <section className={s.hero} data-progress="exit">
          <div className={`${s.wrap} ${s.heroGrid}`}>
            <div className={s.heroCopy}>
              <h1 className={s.h1}>
                {HEADLINE.map((word, i) => (
                  <Fragment key={word}>
                    <span className={s.word}>
                      <span style={{ "--i": i } as React.CSSProperties}>{word}</span>
                    </span>{" "}
                  </Fragment>
                ))}
              </h1>

              <p className={s.sub}>
                Scuba dives, cabs, scooters, stays and island day trips in Port
                Blair, Havelock and Neil. Choose a time, pay online, and your QR ticket is
                on your phone before you leave the hotel.
              </p>

              <div className={s.heroCtas}>
                <Link className={s.btnPrimary} href="/explore">
                  Start booking
                  <Arrow />
                </Link>
                <a className={s.btnGhost} href="#how">See how it works</a>
              </div>
            </div>

            <div className={s.heroStage}>
              <figure className={`${s.float} ${s.floatA}`}>
                <div className={s.floatInner}>
                  <Image src="/marketing/dive-lighthouse.webp" alt="A diver beside a clownfish anemone on the Lighthouse reef, Havelock" fill sizes="(max-width: 900px) 40vw, 260px" priority className={s.cover} />
                  <figcaption className={s.floatCap}>Boat Diving in Lighthouse</figcaption>
                </div>
              </figure>
              <figure className={`${s.float} ${s.floatB}`}>
                <div className={s.floatInner}>
                  <Image src="/marketing/south-button.webp" alt="South Button Island rising out of green water" fill sizes="(max-width: 900px) 44vw, 280px" priority className={s.cover} />
                  <figcaption className={s.floatCap}>South Button day trip</figcaption>
                </div>
              </figure>
              <figure className={`${s.float} ${s.floatC}`}>
                <div className={s.floatInner}>
                  <Image src="/marketing/scooters.webp" alt="A row of rental scooters parked by the sea" fill sizes="(max-width: 900px) 36vw, 220px" className={s.cover} />
                  <figcaption className={s.floatCap}>Scooters by the day</figcaption>
                </div>
              </figure>
              <figure className={`${s.float} ${s.floatD}`}>
                <div className={s.floatInner}>
                  <Image src="/marketing/stay-room.webp" alt="A bright guest room at a Port Blair stay" fill sizes="(max-width: 900px) 36vw, 220px" className={s.cover} />
                  <figcaption className={s.floatCap}>Stays in Port Blair</figcaption>
                </div>
              </figure>

              <Phone className={s.heroPhone}>
                  <Image
                    src={SCREENS.home.src}
                    alt="The Andaman Go home screen: island picker, today's sea report and the eight things you can book."
                    width={SCREENS.home.width}
                    height={SCREENS.home.height}
                    sizes="320px"
                    unoptimized
                    priority
                    decoding="sync"
                    placeholder="blur"
                    blurDataURL={SCREENS.home.blurDataURL}
                    className={s.heroShot}
                  />
                  <Image src="/marketing/screen-nav.webp" alt="" width={780} height={168} unoptimized priority decoding="sync" className={s.shotNav} />
              </Phone>
            </div>
          </div>
        </section>

        {/* --- real listings, drifting --- */}
        <section className={s.ticker} aria-label="Listings on Andaman Go right now">
          <TickerRow items={TICKER_A} />
          <TickerRow items={TICKER_B} reverse />
          <p className={s.tickerNote}>
            Real listings, with the photos their operators uploaded.
          </p>
        </section>

        {/* --- how it works: the pinned phone --- */}
        <Journey qr={qr} />

        {/* --- what you can book --- */}
        <section id="book" className={s.section}>
          <div className={s.wrap}>
            <div className={s.sectionHead} data-reveal>
              <p className={s.eyebrow}>What you can book</p>
              <h2 className={s.h2}>Eight things you&apos;d otherwise book eight different ways</h2>
              <p className={s.lede}>
                One payment and one place your tickets live, instead of a travel agent,
                three phone numbers and a resort desk that takes a cut.
              </p>
            </div>

            <div className={s.bento}>
              <Link href="/activities" className={`${s.tile} ${s.tilePhoto} ${s.tActivities}`} data-reveal>
                <Image src="/marketing/dive-lighthouse.webp" alt="" fill sizes="(max-width: 900px) 100vw, 600px" unoptimized loading="eager" className={s.cover} />
                <span className={s.tileChip}><DiveIcon size={20} /></span>
                <span className={s.tileText}>
                  <strong>Activities</strong>
                  <span>Scuba, snorkelling, sea walks and game fishing, booked against the dive shop&apos;s own timetable.</span>
                </span>
              </Link>

              <Link href="/ferry" className={`${s.tile} ${s.tileInk} ${s.tFerry}`} data-reveal>
                <span className={s.tileChip}><FerryIcon size={20} /></span>
                <svg className={s.seaArt} viewBox="0 0 420 170" fill="none" aria-hidden>
                  {WAVES.map(([x, y], i) => (
                    <path
                      key={i}
                      className={s.seaWave}
                      style={{ "--i": i } as React.CSSProperties}
                      d={`M${x} ${y} q5 -4 10 0 t10 0 t10 0`}
                      stroke="#7FD1C5"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                  ))}
                  <path className={s.seaRoute} d={FERRY_ROUTE} stroke="#7FD1C5" strokeWidth="1.6" strokeLinecap="round" strokeDasharray="2 8" />
                  <Island x={44} y={112} name="Port Blair" />
                  <Island x={216} y={66} name="Havelock" />
                  <Island x={376} y={106} name="Neil" />
                  <g className={s.ferry}>
                    <g className={s.ferryBob}>
                      <path d="M-17 6 q-5 -3 -10 0 M-20 10 q-5 -3 -10 0" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" opacity="0.55" />
                      <rect x="-3" y="-15" width="5" height="7" rx="1" fill="#D9A05B" />
                      <rect x="-9" y="-8" width="16" height="8" rx="2" fill="#E4F0EE" />
                      <path d="M-6 -5h3M-1 -5h3" stroke="#13434C" strokeWidth="2" strokeLinecap="round" />
                      <path d="M-16 0H17L12 9H-12Z" fill="#fff" />
                    </g>
                  </g>
                </svg>
                <span className={s.tileText}>
                  <strong>Ferries</strong>
                  <span>Sailings between Port Blair, Havelock and Neil. Pick a departure and hold seats on it.</span>
                </span>
              </Link>

              <Link href="/stays" className={`${s.tile} ${s.tilePhoto} ${s.tStays}`} data-reveal>
                <Image src="/marketing/stay-room.webp" alt="" fill sizes="(max-width: 900px) 50vw, 300px" unoptimized loading="eager" className={s.cover} />
                <span className={s.tileChip}><BedIcon size={20} /></span>
                <span className={s.tileText}>
                  <strong>Stays &amp; homestays</strong>
                  <span>Rooms booked directly with the host.</span>
                </span>
              </Link>

              <Link href="/scooty" className={`${s.tile} ${s.tilePhoto} ${s.tScooty}`} data-reveal>
                <Image src="/marketing/scooters.webp" alt="" fill sizes="(max-width: 900px) 50vw, 300px" unoptimized loading="eager" className={s.cover} />
                <span className={s.tileChip}><ScooterIcon size={20} /></span>
                <span className={s.tileText}>
                  <strong>Scooter rentals</strong>
                  <span>By the day, from shops with real stock counts.</span>
                </span>
              </Link>

              <Link href="/trips" className={`${s.tile} ${s.tilePhoto} ${s.tTrips}`} data-reveal>
                <Image src="/marketing/adventure.webp" alt="" fill sizes="(max-width: 900px) 100vw, 600px" unoptimized loading="eager" className={`${s.cover} ${s.coverHigh}`} />
                <span className={s.tileChip}><SunSeaIcon size={20} /></span>
                <span className={s.tileText}>
                  <strong>Island adventures</strong>
                  <span>Whole days out, planned and run by someone who lives here.</span>
                </span>
              </Link>

              <Link href="/cabs" className={`${s.tile} ${s.tilePhoto} ${s.tCabs}`} data-reveal>
                <Image src="/marketing/cab.webp" alt="" fill sizes="(max-width: 900px) 50vw, 300px" unoptimized loading="eager" className={s.cover} />
                <span className={s.tileChip}><CarIcon size={20} /></span>
                <span className={s.tileText}>
                  <strong>Cabs</strong>
                  <span>Airport pickups and day hires, fare shown up front.</span>
                </span>
              </Link>

              <Link href="/events" className={`${s.tile} ${s.tilePhoto} ${s.tileStock} ${s.tEvents}`} data-reveal>
                <Image src="/marketing/stock-events.webp" alt="" fill sizes="(max-width: 900px) 50vw, 300px" unoptimized loading="eager" className={s.cover} />
                <span className={s.stageGlow} aria-hidden />
                <span className={s.tileChip}><MusicIcon size={20} /></span>
                <span className={s.eq} aria-hidden>
                  <i /><i /><i /><i /><i /><i /><i />
                </span>
                <span className={s.tileText}>
                  <strong>Events &amp; shows</strong>
                  <span>Music, comedy, theatre and festival nights.</span>
                </span>
              </Link>

              <Link href="/community" className={`${s.tile} ${s.tilePhoto} ${s.tileStock} ${s.tCommunity}`} data-reveal>
                <Image src="/marketing/stock-community.webp" alt="" fill sizes="(max-width: 1240px) 100vw, 1200px" unoptimized loading="eager" className={`${s.cover} ${s.coverLow}`} />
                <span className={s.tileChip}><HandsIcon size={20} /></span>
                <span className={s.freePill} aria-hidden>
                  <i />
                  Free to join
                </span>
                <span className={s.tileText}>
                  <strong>Community service</strong>
                  <span>Beach cleanups, drives and volunteer days. Give the island a morning, and meet the people who live on it.</span>
                </span>
                <span className={s.tileGo} aria-hidden><Arrow /></span>
              </Link>
            </div>
          </div>
        </section>

        {/* --- three islands, one timetable --- */}
        <section className={s.islands} data-progress="view">
          <div className={`${s.wrap} ${s.islandsGrid}`}>
            <div className={s.islandsCopy}>
              <p className={s.eyebrow} data-reveal>Getting between them</p>
              <h2 className={s.h2} data-reveal>Three islands, one timetable</h2>
              <p className={s.lede} data-reveal>
                Every sailing on the route in one list — sorted cheapest, fastest or
                earliest — with the fare for your whole group. No turning up at the
                jetty counter to find out.
              </p>

              <div className={s.route} aria-hidden>
                <span className={s.routeTrack}>
                  <span className={s.routeFill} />
                  <span className={s.routeDot} />
                </span>
                <span className={s.routeStops}>
                  <span><strong>Sri Vijaya Puram</strong>Port Blair</span>
                  <span><strong>Swaraj Dweep</strong>Havelock</span>
                  <span><strong>Shaheed Dweep</strong>Neil</span>
                </span>
              </div>

              <Link className={s.textLink} href="/ferry" data-reveal>
                Check today&apos;s sailings
                <Arrow />
              </Link>
            </div>

            <div className={s.islandsPhoneCol}>
              <Phone className={s.islandsPhone}>
                  <Image
                    src={SCREENS.ferry.src}
                    alt="The ferry screen: ten sailings from Swaraj Dweep to Sri Vijaya Puram with times, durations and fares for two passengers."
                    width={SCREENS.ferry.width}
                    height={SCREENS.ferry.height}
                    sizes="300px"
                    unoptimized
                    decoding="sync"
                    placeholder="blur"
                    blurDataURL={SCREENS.ferry.blurDataURL}
                    className={s.staticShot}
                  />
              </Phone>
              <div className={s.seaCard}>
                <span className={s.seaLabel}>Sea report today</span>
                <span className={s.seaLine}>Calm or rough, it&apos;s on the home screen before you book a crossing.</span>
              </div>
            </div>
          </div>
        </section>

        {/* --- operators --- */}
        <section id="operators" className={s.ops} data-progress="view">
          <div className={`${s.wrap} ${s.opsGrid}`}>
            <div className={s.opsCopy}>
              <p className={s.eyebrowDark} data-reveal>Who you&apos;re booking with</p>
              <h2 className={s.opsTitle} data-reveal>
                A marketplace of island businesses, not resellers
              </h2>
              <p className={s.opsBody} data-reveal>
                Every operator on Andaman Go registered their own business, uploaded their
                licence, and had it read by a person before a single listing went live.
                They set their own prices, timetables and capacity. Nothing is marked up
                on their behalf, and nothing is quietly resold from the mainland.
              </p>
              <ul className={s.facts}>
                <li data-reveal>Licence checked by a human before listing</li>
                <li data-reveal>Prices and availability set by the operator</li>
                <li data-reveal>Message the operator on the booking itself</li>
                <li data-reveal>Scanned on arrival, then your rating unlocks</li>
              </ul>
            </div>

            <div className={s.opsPhotos}>
              <figure className={`${s.opsPhoto} ${s.opsPhotoA}`}>
                <Image src="/marketing/dive-reef.webp" alt="A diver hovering over a coral reef crowded with fish" fill sizes="(max-width: 900px) 70vw, 420px" className={s.cover} />
                <figcaption>Boat Dive · Havelock</figcaption>
              </figure>
              <figure className={`${s.opsPhoto} ${s.opsPhotoB}`}>
                <Image src="/marketing/fishing.webp" alt="A crew member holding up a giant trevally on a fishing charter" fill sizes="(max-width: 900px) 60vw, 340px" className={s.cover} />
                <figcaption>Game Fishing · Port Blair</figcaption>
              </figure>
              <figure className={`${s.opsPhoto} ${s.opsPhotoC}`}>
                <Image src="/marketing/sunset-charter.webp" alt="Two guests at the helm of a charter boat at sunset" fill sizes="(max-width: 900px) 50vw, 280px" className={s.cover} />
                <figcaption>Sunset charter · Port Blair</figcaption>
              </figure>
            </div>
          </div>
        </section>

        {/* --- closing call --- */}
        <section className={s.wrap}>
          <div className={s.closing} data-progress="view">
            <Image src="/marketing/south-button.webp" alt="" fill sizes="(max-width: 1240px) 100vw, 1200px" className={`${s.cover} ${s.closingImg}`} />
            <div className={s.closingInner}>
              <h2 className={s.closingTitle} data-reveal>The islands are open. Go book them.</h2>
              <p className={s.closingSub} data-reveal>
                It runs in your browser, on any phone. No sign-up, no download.
              </p>
              <Link className={s.btnLight} href="/explore" data-reveal>
                Open Andaman Go
                <Arrow />
              </Link>
            </div>
          </div>
        </section>

        {/* --- partner + support --- */}
        <section className={`${s.wrap} ${s.duo}`}>
          <div className={s.duoCard} data-reveal>
            <h2 className={s.duoTitle}>Run a boat, a stay, a cab or a scooter fleet?</h2>
            <p className={s.duoBody}>
              Register your business, add your own listings, and scan tickets from your
              phone.
            </p>
            <Link className={s.textLink} href="/partner">
              Partner sign-up
              <Arrow />
            </Link>
          </div>

          <div className={s.duoCard} data-reveal>
            <h2 className={s.duoTitle}>If something goes wrong, a person answers</h2>
            <p className={s.duoBody}>
              Boat cancelled, operator unreachable, ticket not arrived — write to us with
              your booking reference. We reply within one working day, IST.
            </p>
            <p className={s.duoContact}>
              <a href="mailto:support@andamango.in">support@andamango.in</a>
              <span>+91 94760 33302 · 9:00 – 19:00 IST, all days</span>
            </p>
            <Link className={s.textLink} href="/contact">
              Full contact details
              <Arrow />
            </Link>
          </div>
        </section>
      </main>

      {/* --- footer. The four policy links are what a payments reviewer looks
              for, so they are plain anchors in the markup, not behind a menu. --- */}
      <footer className={s.footer}>
        <div className={s.wrap}>
          <div className={s.footCols}>
            <div className={s.footBrand}>
              <div className={s.footLogoSlot}>
                <Image
                  sizes="180px"
                  src="/brand/andaman-go-dark-mode.png"
                  alt="Andaman Go"
                  width={1600}
                  height={234}
                  className={s.footLogo}
                />
              </div>
              <p className={s.footAbout}>
                Made on the islands, for the people coming to them. Ferries, dives,
                scooters and stays — from operators who are actually here.
              </p>
            </div>

            <div className={s.footCol}>
              <h2 className={s.footHead}>Legal</h2>
              <Link className={s.footLink} href="/terms">Terms &amp; Conditions</Link>
              <Link className={s.footLink} href="/privacy">Privacy Policy</Link>
              <Link className={s.footLink} href="/refunds">Refund &amp; Cancellation</Link>
              <Link className={s.footLink} href="/shipping">Service Delivery</Link>
            </div>

            <div className={s.footCol}>
              <h2 className={s.footHead}>Andaman Go</h2>
              <Link className={s.footLink} href="/explore">Open the app</Link>
              <Link className={s.footLink} href="/contact">Contact us</Link>
              <Link className={s.footLink} href="/partner">Partner sign-up</Link>
            </div>

            <div className={s.footCol}>
              <h2 className={s.footHead}>Registered office</h2>
              <address className={s.footAddress}>
                Near Ayush Store, South Point
                <br />
                Sri Vijaya Puram, South Andaman
                <br />
                Andaman &amp; Nicobar Islands 744106
                <br />
                +91 94760 33302
              </address>
            </div>
          </div>

          <div className={s.footLegal}>
            <span>© {new Date().getFullYear()} Andaman Go. All rights reserved.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Arrow() {
  return (
    <svg className={s.arrow} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
