// Instagram / Facebook in-app browsers (where almost all Meta ad traffic
// lands) can't hand a upi:// link to Google Pay, PhonePe or Paytm. Razorpay's
// web modal then falls back to "enter your UPI ID", the collect request sits
// unapproved, and the payment times out — exactly what Razorpay logged as
// "Customer – Payment Timed Out" on the first day of the Sales ads (Oct 2026).
//
// The fix is to get the traveller into their real browser before they pay.
// Android can be sent straight to Chrome with an intent:// URL; iOS has no
// such hook, so there we tell them which menu item to tap.

export type InAppBrowser = {
  app: "Instagram" | "Facebook";
  os: "android" | "ios" | "other";
};

export function detectInAppBrowser(ua?: string): InAppBrowser | null {
  const agent = ua ?? (typeof navigator !== "undefined" ? navigator.userAgent : "");
  if (!agent) return null;

  let app: InAppBrowser["app"] | null = null;
  if (/Instagram/i.test(agent)) app = "Instagram";
  else if (/FBAN|FBAV|FB_IAB|FBIOS|FB4A/i.test(agent)) app = "Facebook";
  if (!app) return null;

  const os = /Android/i.test(agent) ? "android" : /iPhone|iPad|iPod/i.test(agent) ? "ios" : "other";
  return { app, os };
}

/** An intent:// URL that opens `url` in Chrome on Android, falling back to
 *  the same URL in whatever browser handles it if Chrome isn't installed. */
export function androidChromeIntent(url: string): string {
  const u = new URL(url);
  const fallback = encodeURIComponent(url);
  return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=${u.protocol.replace(":", "")};package=com.android.chrome;S.browser_fallback_url=${fallback};end`;
}
