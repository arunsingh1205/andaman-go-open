"use client";

// Logs one page view per navigation to the first-party traffic table (155)
// and renders nothing. The first view of a browser session is the "landing":
// it alone carries the referrer and utm_* tags, so "where did they come
// from" is counted once per visit, not once per page. Console and ops
// screens are staff, not traffic, and are skipped.

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { recordSiteVisit } from "@/lib/site-visits";

function stored(store: Storage | null, key: string): string {
  try {
    let v = store?.getItem(key);
    if (!v) {
      v = crypto.randomUUID();
      store?.setItem(key, v);
    }
    return v;
  } catch {
    return crypto.randomUUID();
  }
}

export default function VisitBeacon() {
  const pathname = usePathname();

  useEffect(() => {
    if (/^\/(admin|ops|partner|api)(\/|$)/.test(pathname)) return;

    let landing = false;
    try {
      if (!sessionStorage.getItem("visit:landed")) {
        sessionStorage.setItem("visit:landed", "1");
        landing = true;
      }
    } catch {
      // storage blocked — count it as a landing rather than lose the source
      landing = true;
    }

    const qs = new URLSearchParams(window.location.search);
    const native = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;

    void recordSiteVisit({
      visitorId: stored(typeof localStorage === "undefined" ? null : localStorage, "visit:vid"),
      sessionId: stored(typeof sessionStorage === "undefined" ? null : sessionStorage, "visit:sid"),
      path: pathname,
      isLanding: landing,
      referrer: landing ? document.referrer : "",
      utmSource: landing ? (qs.get("utm_source") ?? qs.get("ref") ?? "") : "",
      utmMedium: landing ? (qs.get("utm_medium") ?? "") : "",
      utmCampaign: landing ? (qs.get("utm_campaign") ?? "") : "",
      isApp: Boolean(native?.isNativePlatform?.()),
    });
  }, [pathname]);

  return null;
}
