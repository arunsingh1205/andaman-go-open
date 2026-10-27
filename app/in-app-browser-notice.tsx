"use client";

// Shown above the pay buttons when the page is open inside Instagram's or
// Facebook's own browser, where UPI apps can't be opened (see
// lib/in-app-browser.ts). Renders nothing anywhere else, and nothing in the
// native app (Capacitor's WebView has its own native Razorpay sheet).

import { useEffect, useState } from "react";
import { androidChromeIntent, detectInAppBrowser, type InAppBrowser } from "@/lib/in-app-browser";

export default function InAppBrowserNotice({ className = "" }: { className?: string }) {
  const [iab, setIab] = useState<InAppBrowser | null>(null);

  useEffect(() => {
    setIab(detectInAppBrowser());
  }, []);

  if (!iab) return null;

  const openInChrome = () => {
    window.location.href = androidChromeIntent(window.location.href);
  };

  return (
    <div className={`rounded-2xl border border-amber-300 bg-amber-50 px-3.5 py-3 text-[12.5px] leading-snug text-amber-900 ${className}`}>
      <p className="font-bold">Paying with UPI? Open this page in your browser first.</p>
      <p className="mt-1">
        Google Pay, PhonePe and Paytm can&apos;t open from inside {iab.app}, so UPI payments time out here.
      </p>
      {iab.os === "android" ? (
        <button
          type="button"
          onClick={openInChrome}
          className="mt-2 rounded-full bg-brand px-3.5 py-1.5 text-[12.5px] font-bold text-white"
        >
          Open in Chrome
        </button>
      ) : (
        <p className="mt-1 font-semibold">
          Tap ••• at the top right, choose &ldquo;Open in external browser&rdquo;, then book from there.
        </p>
      )}
    </div>
  );
}
