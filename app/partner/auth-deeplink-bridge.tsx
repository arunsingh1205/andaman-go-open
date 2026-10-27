"use client";

// Catches the deep link a signed-in Google account comes back through after
// continueWithGoogle() (login-form.tsx) hands off to a real browser tab —
// Google's consent screen won't render inside a plain WebView at all, so
// that hop is unavoidable, but it also means the OAuth code initially lands
// in the *browser's* context, not the app's.
//
// Mounted in the root /partner layout (not the dashboard's native-bridge.tsx)
// because this has to be listening before the partner is signed in — the
// deep link arrives while they're still on /partner/login.
//
// The fix is to make the WebView itself perform the cookie-setting request:
// on the deep link, close the browser tab and *navigate the WebView* to the
// same /partner/auth/callback route handler the web flow already uses. That
// request is now made by the WebView, so the Set-Cookie response lands in
// its own storage instead of the browser's — same server code, right
// storage. A full navigation (not router.push) is deliberate: this needs a
// real HTTP round trip to receive that cookie, not a client-side transition.

import { useEffect } from "react";

export default function AuthDeeplinkBridge() {
  useEffect(() => {
    let cleanup: (() => void) | undefined;

    (async () => {
      const { Capacitor } = await import("@capacitor/core");
      if (!Capacitor.isNativePlatform()) return;

      const [{ App }, { Browser }] = await Promise.all([
        import("@capacitor/app"),
        import("@capacitor/browser"),
      ]);

      const listener = await App.addListener("appUrlOpen", async ({ url }) => {
        const opened = new URL(url);
        if (opened.protocol !== "com.andamango.partner:" || opened.hostname !== "auth-callback") {
          return;
        }
        await Browser.close();
        window.location.href = `${window.location.origin}/partner/auth/callback${opened.search}`;
      });
      cleanup = () => listener.remove();
    })();

    return () => cleanup?.();
  }, []);

  return null;
}
