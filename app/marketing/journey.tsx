"use client";

// "How it works": one phone pinned to the screen while the page scrolls
// through a booking, start to finish.
//
// The section is five screens tall and its stage is position: sticky, so the
// phone holds still while scroll distance is spent. That distance is split
// into five equal steps; each step crossfades to its screen, and the scroll
// left over inside a step drives that screen's own scroll (its --t), so the
// reader's thumb is, in effect, scrolling the app.
//
// Four of the five screens are captures of the running app. The last one, the
// ticket, is drawn here so the QR can be scanned on screen — but the code in
// it is a real one, from the same encoder (lib/qr.ts) the app's tickets use.
//
// With no JS or with prefers-reduced-motion nothing is pinned: the stylesheet
// only pins under [data-motion="on"], so the section falls back to the first
// screen beside all five steps written out.

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { QrCode } from "@/lib/qr";
import Phone from "./phone";
import { SCREENS } from "./screens";
import s from "../home.module.css";

const STEPS = [
  {
    title: "Pick your island",
    body: "Port Blair, Havelock or Neil. The home screen changes to what's on that island today, with the sea report at the top.",
  },
  {
    title: "See what's really on",
    body: "Photos, prices and the next departure for every listing, from operators whose licences a person has checked.",
  },
  {
    title: "Choose a day and a time",
    body: "The operator's own timetable, with the seats that are actually left on each slot. Nothing is quietly reassigned.",
  },
  {
    title: "Pay the deposit, or all of it",
    body: "Add who's coming and a mobile number. No account, no password. Pay a part now and the rest on the day, where the category allows it.",
  },
  {
    title: "Walk in with a QR ticket",
    body: "Issued the moment you pay. It lives in Bookings, works offline, and the operator scans it when you arrive.",
  },
];

const SHOTS = [
  {
    screen: SCREENS.home,
    travel: 1,
    nav: true,
    alt: "The Andaman Go home screen for Swaraj Dweep: island picker, today's sea report, eight booking categories and popular listings.",
  },
  {
    screen: SCREENS.activities,
    travel: 1,
    nav: true,
    alt: "The activities list on Swaraj Dweep: scuba and boat dives with photos, operator names, prices and next departure times.",
  },
  {
    screen: SCREENS.pick,
    travel: 1,
    nav: false,
    alt: "An activity page for Boat Diving in Lighthouse, with a day picker and the open time slots.",
  },
  {
    screen: SCREENS.pay,
    travel: 1,
    nav: false,
    alt: "The same booking further down: two guests, a mobile number, and a choice between paying a deposit now or the full amount.",
  },
];

const COUNT = STEPS.length;

export default function Journey({ qr }: { qr: QrCode }) {
  const ref = useRef<HTMLElement>(null);
  const shotRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      if (r.bottom < 0 || r.top > vh) return;

      const p = Math.min(1, Math.max(0, -r.top / Math.max(1, r.height - vh)));
      const x = p * COUNT;
      el.style.setProperty("--p", p.toFixed(4));
      setActive(Math.min(COUNT - 1, Math.floor(x)));

      // Each screen scrolls through the middle of its own step and rests at
      // either end, so a crossfade never lands on a screen that is moving.
      shotRefs.current.forEach((shot, i) => {
        if (!shot) return;
        const t = Math.min(1, Math.max(0, (x - i - 0.12) / 0.7));
        shot.style.setProperty("--t", t.toFixed(4));
      });
    };

    const queue = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    queue();
    window.addEventListener("scroll", queue, { passive: true });
    window.addEventListener("resize", queue);
    return () => {
      window.removeEventListener("scroll", queue);
      window.removeEventListener("resize", queue);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <section id="how" ref={ref} className={s.journey}>
      <div className={s.journeyStage}>
        <div className={`${s.wrap} ${s.journeyGrid}`}>
          <div className={s.journeyCopy}>
            <p className={s.eyebrowDark}>How it works</p>
            <h2 className={s.journeyTitle}>
              From &ldquo;what shall we do?&rdquo; to a ticket in your pocket
            </h2>

            <ol className={s.steps}>
              {STEPS.map(({ title, body }, i) => (
                <li
                  key={title}
                  className={`${s.step} ${i === active ? s.stepOn : ""} ${i < active ? s.stepDone : ""}`}
                >
                  <span className={s.stepNum}>{String(i + 1).padStart(2, "0")}</span>
                  <div className={s.stepText}>
                    <h3 className={s.stepTitle}>{title}</h3>
                    <p className={s.stepBody}>{body}</p>
                  </div>
                </li>
              ))}
            </ol>

            <div className={s.journeyRail} aria-hidden>
              <span className={s.journeyRailFill} />
            </div>
          </div>

          <div className={s.journeyPhoneCol}>
            <div className={s.journeyHalo} aria-hidden />
            {/* The sway class alternates on every step, which restarts its
                keyframes: the phone gives a small turn as the screen changes. */}
            <Phone className={s.journeyPhone} swayClassName={active % 2 ? s.kickA : s.kickB}>
                {SHOTS.map(({ screen, travel, nav, alt }, i) => (
                  <div
                    key={screen.src}
                    ref={(node) => {
                      shotRefs.current[i] = node;
                    }}
                    className={`${s.shot} ${i === active ? s.shotOn : ""}`}
                    style={{ "--travel": travel } as React.CSSProperties}
                    aria-hidden={i !== active}
                  >
                    {/* Loaded up front and decoded synchronously, and scrolled
                        with object-position rather than a transform — see
                        .shotImg in home.module.css for why. */}
                    <Image
                      src={screen.src}
                      alt={alt}
                      width={screen.width}
                      height={screen.height}
                      sizes="320px"
                      unoptimized
                      loading="eager"
                      decoding="sync"
                      placeholder="blur"
                      blurDataURL={screen.blurDataURL}
                      className={s.shotImg}
                    />
                    {i === 2 && <span className={s.tap} aria-hidden />}
                    {nav && (
                      <Image
                        src="/marketing/screen-nav.webp"
                        alt=""
                        width={780}
                        height={168}
                        unoptimized
                        loading="eager"
                        decoding="sync"
                        className={s.shotNav}
                      />
                    )}
                  </div>
                ))}

                <div
                  className={`${s.shot} ${s.ticketShot} ${active === COUNT - 1 ? `${s.shotOn} ${s.ticketPlay}` : ""}`}
                  aria-hidden={active !== COUNT - 1}
                >
                  <div className={s.ticketBack}>
                    <p className={s.ticketBackTitle}>Bookings</p>
                    <p className={s.ticketBackSub}>Fri, Oct 9 · Swaraj Dweep</p>
                  </div>
                  <div className={s.ticketSheet}>
                    <p className={s.ticketName}>Boat Diving in Lighthouse</p>
                    <p className={s.ticketBy}>Frogman</p>
                    <div className={s.ticketQr}>
                      <svg viewBox={`0 0 ${qr.size} ${qr.size}`} role="img" aria-label="A sample QR ticket">
                        <path d={qr.path} fill="#0B2422" />
                      </svg>
                      <span className={s.ticketScan} aria-hidden />
                    </div>
                    <p className={s.ticketRef}>AG-S868V-A</p>
                    <p className={s.ticketMeta}>Fri 9 Oct · 7:00 AM · 2 guests</p>
                    <p className={s.ticketDone}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M4 12.5l5 5L20 6.5" />
                      </svg>
                      Scanned · you&apos;re on the boat
                    </p>
                  </div>
                </div>
            </Phone>

            <p className={s.journeyCount} aria-hidden>
              <span>{String(active + 1).padStart(2, "0")}</span> / {String(COUNT).padStart(2, "0")}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
