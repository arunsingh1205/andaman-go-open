"use client";

// Bridges the few things a browser tab can't do for itself but a wrapped
// native app is expected to: color the system status bar, let the hardware
// back button navigate the WebView's history instead of doing nothing,
// dismiss the native splash screen once real content is on screen, and
// register this device for push notifications. Same role as
// app/partner/(dashboard)/native-bridge.tsx — see lib/traveller-push.ts and
// supabase/126-traveller-push-notifications.sql for the device-token side,
// and that migration's header comment for what actually triggers a push
// (booking state changes — confirmed/disrupted/refunded) and why there's no
// in-app notification list to deep-link a tap into (unlike the partner
// side): taps just land on /bookings, the closest existing screen to "see
// what this is about."
//
// Lives in the root layout (see app/layout.tsx), so
// it skips /partner and /admin for the same reason that one does: the
// partner dashboard already mounts its own native-bridge.tsx scoped to
// itself. Without this guard, opening the *partner* native app would run
// both bridges at once — two status-bar colors racing, two "backButton"
// listeners firing per press.
//
// Every call here is a no-op in a normal browser tab —
// Capacitor.isNativePlatform() is false there — so this component is safe
// to render unconditionally elsewhere and never affects the plain web
// experience (mobile or desktop).

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { registerTravellerPushToken } from "@/lib/traveller-push";
import { NativeChrome } from "@/lib/native-chrome";

export default function NativeBridge() {
  const pathname = usePathname();
  const router = useRouter();
  const skip = pathname?.startsWith("/partner") || pathname?.startsWith("/admin");

  useEffect(() => {
    if (skip) return;
    let cleanup: (() => void) | undefined;

    (async () => {
      const { Capacitor } = await import("@capacitor/core");
      if (!Capacitor.isNativePlatform()) return;

      // Imported and held outside the try block below, not inside the
      // Promise.all with everything else: capacitor.config.ts sets
      // launchAutoHide: false specifically so the branded splash only ever
      // comes down from the finally block at the end of this function —
      // and that guarantee is worthless if the one plugin doing the hiding
      // could itself fail to import. A splash that never hides reads as a
      // frozen app; that has to be impossible here, not just unlikely.
      const { SplashScreen } = await import("@capacitor/splash-screen");

      try {
        // Marks the document as running inside the app, which is what
        // globals.css keys the glass bottom bar off. Deliberately a CSS
        // switch rather than a React one: the bar is in the first paint,
        // and branching on it in JSX would either mismatch on hydration or
        // flash the web bar for a frame on every launch.
        document.documentElement.dataset.native = Capacitor.getPlatform();

        const [{ StatusBar, Style }, { App }, { PushNotifications }] = await Promise.all([
          import("@capacitor/status-bar"),
          import("@capacitor/app"),
          import("@capacitor/push-notifications"),
        ]);

        // Style.Light = dark icons/text, for use against a light bar — not
        // "light mode". The traveller app's screens sit on --color-ground, and
        // capacitor.config.ts paints the native chrome the same colour, so a
        // teal bar with white glyphs would have been a dark band above a light
        // app. #F2F6F5 here keeps Android's status bar in step with that; on
        // iOS setBackgroundColor is a no-op and the style is what matters.
        await StatusBar.setBackgroundColor({ color: "#F2F6F5" });
        await StatusBar.setStyle({ style: Style.Light });

        const backListener = await App.addListener("backButton", ({ canGoBack }) => {
          if (canGoBack) window.history.back();
          else App.exitApp();
        });

        // The other half of the native tab bar's tap handling — see
        // ios-app/App/App/AppRootViewController.swift, which dispatches this
        // event through the bridge rather than trying to learn Next.js's
        // router from the native side. router.push keeps the SPA's
        // client-side navigation (no full reload), the same as every
        // next/link tap already does.
        const onNativeTabNavigate = (e: Event) => {
          const href = (e as CustomEvent<{ href: string }>).detail?.href;
          if (href) router.push(href);
        };
        window.addEventListener("native-tab-navigate", onNativeTabNavigate);

        // Tells AppRootViewController.swift's native tab bar and back
        // button whether to show themselves, and for what route — the
        // instant this page's own DOM says so, not on a native-side timer.
        // (A native profile button used to be driven from here too;
        // removed once it turned out to double up with the web's own
        // profile icon on Home instead of cleanly replacing it.) Two earlier
        // attempts at this (native polling evaluateJavaScript on a schedule)
        // raced against React's own render and reliably lost that race on a
        // slow cold launch, leaving chrome stuck hidden. A MutationObserver
        // has no such race: it fires exactly when the DOM it's watching
        // actually changes, whether that's the first paint, a route change,
        // or hydration finishing late. window.webkit.messageHandlers only
        // exists where the native side actually registered this channel
        // (iOS 26+ — see AppRootViewController.swift); everywhere else,
        // including Android and pre-26 iOS, this is simply absent and the
        // whole block below is skipped.
        let chromeObserver: MutationObserver | undefined;
        let stopWatchingWidth: (() => void) | undefined;
        const nativeChrome = (
          window as unknown as {
            webkit?: { messageHandlers?: { nativeChrome?: { postMessage: (body: unknown) => void } } };
          }
        ).webkit?.messageHandlers?.nativeChrome;
        // Android has no WKWebView-style message handler to feature-test —
        // NativeChrome.setState() (lib/native-chrome.ts) always "exists" as
        // a callable proxy regardless of platform, so platform is checked
        // directly instead. Same {tabBar, back, path} contract either way;
        // only which channel postChromeState() below actually posts to
        // differs.
        const isAndroid = Capacitor.getPlatform() === "android";
        if (nativeChrome || isAndroid) {
          // observe(document.body, { subtree: true }) means this fires on
          // *any* DOM change anywhere on the page — a scrolling list lazily
          // rendering cards, an image finishing a load state, any of a
          // hundred things with nothing to do with chrome — not just the
          // handful of times .glass-nav/[data-page-back] actually appear or
          // disappear. Posting on every single one of those was the "not
          // smooth" bug: native was getting flooded with messages during
          // ordinary scrolling, each one a real round trip and a real
          // UIView update on the other end, competing with scroll rendering
          // for the same frame budget.
          //
          // Two guards fix it without losing the instant reaction the
          // MutationObserver exists for in the first place: requestAnimationFrame
          // coalesces a whole burst of same-frame mutations into one check
          // (scrolling one list re-render is dozens of DOM writes, not
          // dozens of reasons to message native), and the dedupe below means
          // a check that finds nothing actually changed since the last one
          // never posts at all — so native only ever hears about it when
          // tabBar/back/path genuinely change, exactly the amount of
          // "instant" this needed and no more.
          let lastState = "";
          let frameScheduled = false;
          // From `lg` (an iPad in landscape) desktop-nav.tsx's top navbar
          // carries navigation and bottom-nav.tsx hides itself, so the native
          // tab bar must go too or the screen shows two sets of tabs. Rotating
          // the iPad or resizing a Split View window crosses this line with no
          // DOM change, hence the listener below.
          const wide = window.matchMedia("(min-width: 1024px)");
          const postChromeState = () => {
            frameScheduled = false;
            const state = {
              tabBar: document.querySelector(".glass-nav") !== null && !wide.matches,
              back: document.querySelector("[data-page-back]") !== null,
              path: window.location.pathname,
            };
            const next = JSON.stringify(state);
            if (next === lastState) return;
            lastState = next;
            if (nativeChrome) {
              nativeChrome.postMessage(state);
            } else if (isAndroid) {
              void NativeChrome.setState(state).catch(() => {});
            }
          };
          postChromeState();
          chromeObserver = new MutationObserver(() => {
            if (frameScheduled) return;
            frameScheduled = true;
            requestAnimationFrame(postChromeState);
          });
          chromeObserver.observe(document.body, { childList: true, subtree: true });
          wide.addEventListener("change", postChromeState);
          stopWatchingWidth = () => wide.removeEventListener("change", postChromeState);
        }

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
              void registerTravellerPushToken(
                token.value,
                Capacitor.getPlatform() === "ios" ? "ios" : "android",
              );
            }),
          );
          listeners.push(
            await PushNotifications.addListener("pushNotificationActionPerformed", () => {
              router.push("/bookings");
            }),
          );
          await PushNotifications.register();
        }

        // Apple's tracking prompt, for Meta's App Events SDK (see
        // capacitor-plugins/meta-app-events). After the push prompt rather
        // than alongside it, so the two never stack. iOS shows it once ever
        // and answers instantly after that, so asking every launch is safe.
        // Not awaited: the splash comes down and the app is usable while the
        // prompt is up, and a refusal or failure costs this launch nothing.
        // Builds without the plugin skip it entirely.
        if (Capacitor.getPlatform() === "ios" && Capacitor.isPluginAvailable("MetaAppEvents")) {
          void import("@/lib/meta-app-events")
            .then(({ MetaAppEvents }) => MetaAppEvents.requestTracking())
            .catch(() => {
              // Tracking is optional; installs are still counted without it.
            });
        }

        cleanup = () => {
          listeners.forEach((l) => l.remove());
          window.removeEventListener("native-tab-navigate", onNativeTabNavigate);
          chromeObserver?.disconnect();
          stopWatchingWidth?.();
        };
      } finally {
        // Whatever above succeeded or failed, the branded splash must come
        // down — capacitor.config.ts's launchAutoHide: false means this is
        // the only thing that ever hides it. A frozen splash from one
        // failed permission check would be a far worse experience than
        // this launch simply not having, say, push notifications wired up.
        await SplashScreen.hide();
      }
    })();

    return () => cleanup?.();
  }, [skip, router]);

  // No scrim over the status bar. ios.contentInset: "always" already insets
  // the WebView past it and clips whatever scrolls up, so an overlay sized by
  // env(safe-area-inset-top) reserved the same strip a second time - it sat
  // just below the status bar and hid the top 59pt of every screen (on
  // /profile, the avatar and name row). See the --safe-top note in
  // globals.css.
  return null;
}
