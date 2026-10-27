"use client";

// Bridges the few things a browser tab can't do for itself but a wrapped
// native app is expected to: color the system status bar, let the hardware
// back button navigate the WebView's history instead of doing nothing,
// dismiss the splash screen once real content is on screen, and register
// this device for push notifications.
//
// Every call here is a no-op in a normal browser tab — Capacitor.isNativePlatform()
// is false there — so this component is safe to render unconditionally and
// never affects the plain web experience (mobile or desktop).

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { registerPushToken } from "@/lib/partner-push";
import { notificationHref, type PartnerNotificationKind } from "@/lib/partner-notification-kinds";

export default function NativeBridge() {
  const router = useRouter();

  useEffect(() => {
    let cleanup: (() => void) | undefined;

    (async () => {
      const { Capacitor } = await import("@capacitor/core");
      if (!Capacitor.isNativePlatform()) return;

      // Same marker app/native-bridge.tsx sets for the traveller app, and
      // globals.css already has the matching rule for it
      // (:root[data-native] { --safe-top: 0px; }) — added once
      // PartnerRootViewController.swift started pinning the WebView's own
      // frame below the notch, the same fix the traveller app already had.
      // Without this, partner-header.tsx's --safe-top padding stacked on
      // top of a WebView that already starts below the notch, pushing the
      // header down by the safe-area height a second time — the large empty
      // white gap above the header. --safe-bottom is untouched by that rule
      // on purpose: the WebView still runs to the bottom edge, so the
      // bottom nav still needs the real value.
      document.documentElement.dataset.native = Capacitor.getPlatform();

      // Held outside the try block below, not inside the Promise.all with
      // everything else: capacitor.config.ts sets launchAutoHide: false
      // specifically so the branded splash only ever comes down from the
      // finally block at the end of this function — worthless if the one
      // plugin doing the hiding could itself fail to import. A splash that
      // never hides reads as a frozen app; that has to be impossible here.
      const { SplashScreen } = await import("@capacitor/splash-screen");

      try {
        const [{ StatusBar, Style }, { App }, { PushNotifications }] = await Promise.all([
          import("@capacitor/status-bar"),
          import("@capacitor/app"),
          import("@capacitor/push-notifications"),
        ]);

        // Style.Light = dark icons/text, for use against the light bar the
        // partner dashboard's own screens actually sit on (--color-ground,
        // #F2F6F5) — not "light mode". This used to be brand teal with
        // Style.Dark (light icons) on the theory that partner screens were
        // dark; they aren't, so a teal bar with white glyphs read as a dark
        // band above a light app, same issue the traveller app already
        // fixed. capacitor.config.ts's chromeColor drives the matching
        // native strips (ios.backgroundColor/EdgeToEdge); this is only the
        // status bar icon color, which that plugin doesn't control.
        await StatusBar.setBackgroundColor({ color: "#F2F6F5" });
        await StatusBar.setStyle({ style: Style.Light });

        const backListener = await App.addListener("backButton", ({ canGoBack }) => {
          if (canGoBack) window.history.back();
          else App.exitApp();
        });

        // Registration only sends the token to the OS/FCM; requestPermissions()
        // is what actually prompts the person (a no-op on Android 12 and below,
        // where notification permission can't be denied in the first place).
        const listeners = [backListener];
        const perm = await PushNotifications.checkPermissions();
        if (perm.receive === "prompt") {
          await PushNotifications.requestPermissions();
        }
        const nowPerm = await PushNotifications.checkPermissions();
        if (nowPerm.receive === "granted") {
          listeners.push(
            await PushNotifications.addListener("registration", (token) => {
              void registerPushToken(token.value, Capacitor.getPlatform() === "ios" ? "ios" : "android");
            }),
          );
          listeners.push(
            await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
              const data = action.notification.data as { kind?: PartnerNotificationKind; itemId?: string } | null;
              const href = data?.kind ? notificationHref(data.kind, data.itemId ?? null) : "/partner/notifications";
              router.push(href ?? "/partner/notifications");
            }),
          );
          await PushNotifications.register();
        }

        cleanup = () => listeners.forEach((l) => l.remove());
      } finally {
        // Whatever above succeeded or failed, the branded splash must come
        // down — capacitor.config.ts's launchAutoHide: false means this is
        // the only thing that ever hides it.
        await SplashScreen.hide();
      }
    })();

    return () => cleanup?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
