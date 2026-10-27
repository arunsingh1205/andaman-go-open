"use client";

// Meta (Facebook / Instagram) Pixel — lets ads be measured and retargeted.
// The pixel ID is public by design (it ships in every page's HTML).
// The base code fires the first PageView; the app is a single-page shell, so
// later navigations fire their own. Staff screens are left out so the console
// doesn't pollute ad audiences.
//
// Not loaded inside an app build that carries the MetaAppEvents plugin:
// there, Meta's App Events SDK reports the same funnel as app events
// (lib/meta-events.ts), and running both would count every booking twice.
// Older installs without the plugin keep the pixel, so they never go dark
// while people update. The check sits inside the snippet
// rather than in React so it can't lose a race with hydration — Capacitor's
// bridge is already on window before any page script runs. With no fbq
// defined, the route-change PageView below is a no-op in the app.

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import Script from "next/script";

const PIXEL_ID = "2151476082123501";
const STAFF = /^\/(admin|ops|partner)(\/|$)/;

type Fbq = (...args: unknown[]) => void;

export default function MetaPixel() {
  const pathname = usePathname();
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false; // the base snippet already tracked this one
      return;
    }
    if (STAFF.test(pathname)) return;
    (window as unknown as { fbq?: Fbq }).fbq?.("track", "PageView");
  }, [pathname]);

  if (STAFF.test(pathname)) return null;

  return (
    <>
      <Script id="meta-pixel" strategy="afterInteractive">
        {`!function(f,b,e,v,n,t,s){if(f.fbq||(f.Capacitor&&f.Capacitor.isNativePlatform&&f.Capacitor.isNativePlatform()&&f.Capacitor.isPluginAvailable&&f.Capacitor.isPluginAvailable('MetaAppEvents')))return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${PIXEL_ID}');fbq('track','PageView');`}
      </Script>
      <noscript>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          height="1"
          width="1"
          style={{ display: "none" }}
          alt=""
          src={`https://www.facebook.com/tr?id=${PIXEL_ID}&ev=PageView&noscript=1`}
        />
      </noscript>
    </>
  );
}
