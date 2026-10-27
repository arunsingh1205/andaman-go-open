"use client";

// Runs the app's one location check, exactly once per device, and does two
// things with whatever it finds: puts up a dismissible notice if the
// traveller is outside Andaman & Nicobar, and — on a genuinely first visit,
// before anyone has picked an island — sets the island to whichever of the
// three they're actually closest to, so the app opens already showing
// what's around them instead of defaulting to Havelock for everyone.
//
// One getCurrentPosition() call does both. There's only one underlying OS
// permission grant either way, but there's no reason to make two separate
// requests (and coordinate which one gets to ask first) when a single
// coordinate answers both questions.
//
// Uses lib/geolocation.ts's currentPosition(), which routes to
// @capacitor/geolocation (a real, persistent OS permission — asked once,
// shown in iOS Settings > Privacy > Location Services, the manifest
// declaration is NSLocationWhenInUseUsageDescription in
// ios-app/App/App/Info.plist / the AndroidManifest.xml equivalent) on
// native, and to plain navigator.geolocation on the web — see that file for
// why raw navigator.geolocation inside a WKWebView isn't the same as a real
// native prompt.
//
// localStorage (not sessionStorage) is what makes the ask-once
// once-per-device rather than once-per-tab-session: the flag is written the
// moment the check is *asked for*, before the browser/OS prompt even
// resolves, so a denial is remembered exactly the same as a grant and we
// never prompt again either way. Capacitor's WebView keeps its own
// persistent localStorage the same way a real browser profile does, so
// this holds for the native app too.
//
// Lives inside IslandProvider in app/layout.tsx — the auto-select half
// needs useIsland() — and skips /partner and /admin for the same reason
// native-bridge.tsx does: this is about travellers finding their island,
// not about partner/admin staff.

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { isWithinAndamanNicobar } from "@/lib/andaman-bounds";
import { currentPosition } from "@/lib/geolocation";
import { nearestIslandId } from "@/lib/islands";
import { hasChosenIsland, useIsland } from "@/lib/island-context";
import { PinIcon, CloseIcon } from "./icons";

const ASKED_KEY = "ag_location_asked";

export default function LocationBootstrap() {
  const pathname = usePathname();
  const skip = pathname?.startsWith("/partner") || pathname?.startsWith("/admin");
  const [show, setShow] = useState(false);
  const { setIslandId } = useIsland();

  useEffect(() => {
    if (skip) return;

    let alreadyAsked = false;
    try {
      alreadyAsked = localStorage.getItem(ASKED_KEY) === "1";
    } catch {
      // Private-browsing or blocked storage — can't remember, so don't ask
      // at all rather than risk asking every time.
      return;
    }
    if (alreadyAsked) return;

    // Mark it asked right away, before the prompt even resolves — a denial
    // is a real answer too, and shouldn't get asked again next time either.
    try {
      localStorage.setItem(ASKED_KEY, "1");
    } catch {
      return;
    }

    let cancelled = false;
    currentPosition().then((pos) => {
      if (cancelled || !pos) {
        // Denied, unavailable, or timed out — say nothing. Not knowing
        // someone's location isn't the same as knowing they're elsewhere,
        // and the island picker's own default is a perfectly fine
        // fallback either way.
        return;
      }
      const { latitude, longitude } = pos;
      if (!isWithinAndamanNicobar(latitude, longitude)) {
        setShow(true);
        return;
      }
      // Only on a genuinely first visit — this must never fight a choice,
      // manual or a previous auto-detection, that already happened.
      if (!hasChosenIsland()) {
        setIslandId(nearestIslandId(latitude, longitude));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [skip, setIslandId]);

  if (!show) return null;

  return (
    <div
      className="fixed inset-x-0 top-0 z-50 px-4"
      style={{ paddingTop: "calc(var(--safe-top) + 0.75rem)" }}
    >
      <div className="mx-auto flex max-w-[430px] items-start gap-2.5 rounded-2xl bg-sandsoft px-4 py-3 text-sandink shadow-lg">
        <PinIcon size={17} className="mt-0.5 shrink-0" />
        <p className="flex-1 text-[12.5px] leading-snug font-semibold">
          Looks like you&apos;re outside Andaman &amp; Nicobar — we&apos;re only serviceable on the
          islands right now, but feel free to browse and plan ahead.
        </p>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => setShow(false)}
          className="-mt-1 -mr-1 flex h-8 w-8 shrink-0 items-center justify-center opacity-70"
        >
          <CloseIcon size={16} />
        </button>
      </div>
    </div>
  );
}
