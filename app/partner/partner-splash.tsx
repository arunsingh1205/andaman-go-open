"use client";

// Hides the *native* branded splash for every signed-out /partner route.
// Used to also play an animated "andaman GO" overlay here (blurred blobs +
// letter-by-letter build-up) right after the native splash — removed on
// request; this component's only job now is the hide call below. The
// traveller app's own copy (app/app-splash.tsx) played the same animation on
// Android and was removed the same way; its CSS keyframes
// (partner-splash-blob-a/b, partner-splash-letter-in, partner-splash-go-drop)
// were removed from globals.css at the same time, since nothing renders them
// anymore.
//
// capacitor.config.ts sets launchAutoHide: false unconditionally for both
// apps (added for the traveller app's own launch-gap fix), so the native
// splash only ever comes down when something explicitly calls
// SplashScreen.hide(). For the partner app, that call also lives in
// app/partner/(dashboard)/native-bridge.tsx — but that only mounts once
// someone is already logged in. A fresh install always lands on
// /partner/login first, outside (dashboard), so without this, the native
// splash would be stuck forever on every signed-out screen. Lives in
// app/partner/layout.tsx, above (dashboard), so it covers every /partner
// route regardless of auth state; calling SplashScreen.hide() twice (once
// here, once from (dashboard)'s own bridge) is harmless.
//
// Also posts to the "splashHide" channel PartnerRootViewController.swift
// registers — @capacitor/splash-screen's own plugin hardcodes the WebView as
// its splash's parent and sizes it to the full window regardless of that
// parent's actual (now notch-inset) frame, which is what made the launch
// logo render off-center once the WebView's own frame started below the
// notch. PartnerRootViewController draws its own correctly-positioned splash
// over everything and hides it on this message; window.webkit only exists on
// native iOS, so this is a no-op everywhere else, same guard native-bridge
// files elsewhere in this app already use for the equivalent channel.

import { useEffect } from "react";

export default function PartnerSplash() {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { Capacitor } = await import("@capacitor/core");
      if (cancelled || !Capacitor.isNativePlatform()) return;
      const { SplashScreen } = await import("@capacitor/splash-screen");
      await SplashScreen.hide();
      (
        window as unknown as {
          webkit?: { messageHandlers?: { splashHide?: { postMessage: (body: unknown) => void } } };
        }
      ).webkit?.messageHandlers?.splashHide?.postMessage({});
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
