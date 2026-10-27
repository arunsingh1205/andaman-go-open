import type { Metadata, Viewport } from "next";
import Image from "next/image";
import WaitlistForm from "./waitlist-form";
import s from "./soon.module.css";

export const metadata: Metadata = {
  title: "Andaman Go — launching soon",
  description:
    "Ferries, stays and island activities across the Andamans, booked in one place. Leave your email and we'll tell you the moment we're live.",
};

// The rest of the app is light (#F2F6F5); this one page is deep water, so it
// overrides the root theme colour to keep the phone's status bar in step.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#041816",
};

// Plankton drifting up through the water. Hand-placed rather than random so
// the field is evenly spread and identical on server and client — a
// Math.random() here would hydrate-mismatch every load.
const PARTICLES = [
  { left: "8%", bottom: 60, size: 3, dur: 26, delay: 0 },
  { left: "17%", bottom: 20, size: 2, dur: 34, delay: 3.5 },
  { left: "27%", bottom: 110, size: 4, dur: 22, delay: 7 },
  { left: "35%", bottom: 0, size: 2.5, dur: 30, delay: 11 },
  { left: "45%", bottom: 70, size: 3, dur: 38, delay: 1.5 },
  { left: "52%", bottom: 30, size: 2, dur: 24, delay: 14 },
  { left: "60%", bottom: 120, size: 3.5, dur: 32, delay: 5 },
  { left: "68%", bottom: 10, size: 2, dur: 28, delay: 9 },
  { left: "76%", bottom: 88, size: 3, dur: 36, delay: 2 },
  { left: "84%", bottom: 40, size: 2.5, dur: 25, delay: 16 },
  { left: "91%", bottom: 100, size: 4, dur: 40, delay: 6.5 },
  { left: "4%", bottom: 140, size: 2, dur: 33, delay: 12.5 },
  { left: "96%", bottom: 24, size: 3, dur: 29, delay: 18 },
  { left: "40%", bottom: 150, size: 2, dur: 42, delay: 20 },
];

export default function ComingSoonPage() {
  return (
    <main className={s.stage}>
      {/* --- water --- */}
      <div className={`${s.layer} ${s.surface}`} aria-hidden />
      <div className={`${s.beam} ${s.beamA}`} aria-hidden />
      <div className={`${s.beam} ${s.beamB}`} aria-hidden />
      <div className={`${s.layer} ${s.seabed}`} aria-hidden />

      <svg
        className={s.contours}
        viewBox="0 0 1600 420"
        preserveAspectRatio="none"
        aria-hidden
      >
        <g fill="none" stroke="#3FA396" strokeWidth="1.1">
          <path
            d="M-20 300 C 180 250, 340 350, 560 306 S 940 232, 1160 292 S 1460 348, 1620 296"
            opacity="0.30"
          />
          <path
            d="M-20 336 C 200 292, 360 386, 600 340 S 960 268, 1180 330 S 1470 384, 1620 332"
            opacity="0.24"
          />
          <path
            d="M-20 372 C 220 330, 400 420, 640 374 S 980 306, 1200 366 S 1480 416, 1620 366"
            opacity="0.18"
          />
        </g>
      </svg>

      <svg
        className={`${s.contours} ${s.contoursB}`}
        viewBox="0 0 1600 420"
        preserveAspectRatio="none"
        aria-hidden
      >
        <g fill="none" stroke="#5FBFAE" strokeWidth="1">
          <path
            d="M-20 262 C 160 214, 320 312, 520 268 S 900 196, 1120 254 S 1440 310, 1620 258"
            opacity="0.22"
          />
          <path
            d="M-20 226 C 150 182, 300 274, 500 232 S 880 162, 1100 218 S 1420 272, 1620 222"
            opacity="0.14"
          />
          <path
            className={s.sonar}
            d="M-20 190 C 150 148, 300 236, 500 196 S 880 128, 1100 182 S 1420 236, 1620 186"
            opacity="0.30"
          />
        </g>
      </svg>

      {PARTICLES.map((p, i) => (
        <span
          key={i}
          className={s.particle}
          aria-hidden
          style={{
            left: p.left,
            bottom: p.bottom,
            width: p.size,
            height: p.size,
            animationDuration: `${p.dur}s`,
            animationDelay: `${p.delay}s`,
          }}
        />
      ))}

      <div className={s.hairline} aria-hidden />
      <div className={`${s.layer} ${s.grain}`} aria-hidden />

      {/* --- content --- */}
      <div className={`${s.rail} ${s.topRail} ${s.reveal} ${s.d7}`}>
        <span>Andaman &amp; Nicobar Islands</span>
        <span className={s.railEnd}>andamango.in</span>
      </div>

      <div className={s.content}>
        <div className={`${s.eyebrow} ${s.reveal} ${s.d1}`}>
          <span className={s.pip} aria-hidden>
            <span className={s.dot} />
            <span className={s.ring} />
          </span>
          Coming soon
        </div>

        {/* The lockup on its dark-ground variant: "andaman" in near-white,
            the GO mark left in brand mint. The slot is a fixed box, so the
            mark's own width can change without shifting anything below. */}
        <div className={`${s.logoSlot} ${s.reveal} ${s.d2}`}>
          <Image
            sizes="300px"
            src="/brand/andaman-go-dark-mode.png"
            alt="Andaman Go"
            width={1600}
            height={234}
            priority
            className={s.logo}
          />
        </div>

        <h1 className={`${s.headline} ${s.reveal} ${s.d3}`}>
          <span className={s.shine}>The islands are ready.</span>
          <br />
          <span className={s.dim}>The booking part is nearly there.</span>
        </h1>

        <p className={`${s.sub} ${s.reveal} ${s.d4}`}>
          Ferries, stays and island activities across Port Blair, Havelock and Neil — planned
          and paid for in one place. We&apos;re building it now.
        </p>

        <div className={`${s.formWrap} ${s.reveal} ${s.d5}`}>
          <WaitlistForm />
        </div>

        <p className={`${s.note} ${s.reveal} ${s.d6}`}>
          One email when bookings open. Nothing else.
        </p>
      </div>

      <div className={`${s.rail} ${s.bottomRail} ${s.reveal} ${s.d7}`}>
        <div className={s.railSet}>
          <span>Ferries</span>
          <span>Stays</span>
          <span>Activities</span>
        </div>
        {/* Partner contact goes here once the address exists:
            <a href="mailto:partners@andamango.in">Partner enquiries</a> */}
      </div>
    </main>
  );
}
