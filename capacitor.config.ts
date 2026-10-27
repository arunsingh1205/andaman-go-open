import type { CapacitorConfig } from "@capacitor/cli";

// This wraps the *existing* Next.js app rather than a static export or a
// from-scratch React Native rebuild. Server-side auth (Supabase cookies),
// API routes, and middleware don't survive `next export`. So instead of
// bundling local files, the WebView is pointed at a live server via
// `server.url`, exactly like a desktop browser tab. `webDir` still has to
// point at *something* on disk (Capacitor's requirement) —
// capacitor/www/index.html is a placeholder that is never actually seen
// unless server.url is unreachable.
//
// Two apps share this one repo — the Partner dashboard (app/partner/) and
// the traveller app (everything else under app/) — so this file builds
// either one depending on CAP_TARGET:
//
//   CAP_TARGET unset or "partner"  -> Andaman GO Partner (com.andamango.partner)
//   CAP_TARGET=customer            -> Andaman GO (com.andamango.app)
//
// Each target gets its own native project directory (android/ + ios/ for
// partner, android-app/ + ios-app/ for customer) via the android.path /
// ios.path fields below, so `npx cap add android` for one never touches the
// other's already-generated project. Set CAP_TARGET before every `cap`
// command (add/sync/open/build) — Capacitor reads this file fresh each time,
// but the native project itself only picks up a change once you sync again.
//
// CAP_SERVER_URL controls which server the app loads:
//   - Local dev on your phone: run `npm run dev`, then a tunnel
//     (see next.config.ts's allowedDevOrigins for the tunnel hosts already
//     allow-listed) or your PC's LAN IP, e.g. http://192.168.1.23:3000
//   - Production: your deployed domain, e.g. https://andamango.com
// Set it before running `npx cap sync` (android and/or ios), since Capacitor
// bakes this value into the native project at sync time — changing the env
// var alone does nothing until you sync again.
const isCustomer = process.env.CAP_TARGET === "customer";

const defaultServerUrl = isCustomer ? "http://10.0.2.2:3000" : "http://10.0.2.2:3000/partner";
const serverUrl = process.env.CAP_SERVER_URL || defaultServerUrl;

// The traveller app's brand teal is a shade darker (#0C434C, matching
// app/app-splash.tsx and app/partner/partner-splash.tsx's shared animation)
// than the partner dashboard's own #13434C — same family, deliberately
// distinct so the two app icons/splash screens are never confused for each
// other on a phone that has both installed.
const brandColor = isCustomer ? "#0C434C" : "#13434C";

// What the native chrome around the WebView is painted with: the strips
// behind the status bar and the home indicator, which iOS exposes because
// ios.contentInset is "always".
//
// Both apps' screens sit on --color-ground (#F2F6F5) — painting those
// strips brand teal put a dark band above and below a light app, reading
// as a web page in a frame rather than as an app. This used to be
// customer-only, on the theory that the partner dashboard's own screens
// were dark; they aren't (white header, light grey background, same as the
// traveller app), so that carve-out was stale — both native-bridge.tsx
// files switch their status bar to dark-on-light to suit. brandColor still
// drives the splash screen for both, which is meant to be teal.
const chromeColor = "#F2F6F5";

const config: CapacitorConfig = {
  appId: isCustomer ? "com.andamango.app" : "com.andamango.partner",
  appName: isCustomer ? "Andaman GO" : "Andaman GO Partner",
  webDir: "capacitor/www",
  server: {
    url: serverUrl,
    // Without this, iOS hands any navigation whose host is not exactly
    // server.url's host to Safari, and the person watches the app bounce
    // out to the browser. andamango.in 308-redirects to www.andamango.in,
    // and NEXT_PUBLIC_SITE_URL / absolute links in emails and metadata use
    // the apex, so both spellings have to count as "still inside the app".
    allowNavigation: ["andamango.in", "www.andamango.in", "*.andamango.in"],
    // Required for cookie-based Supabase auth to behave like a real HTTPS
    // site inside the WebView. Only matters once serverUrl itself is https —
    // http://10.0.2.2 (the Android emulator's alias for the host PC) is the
    // one deliberate exception, for local dev only.
    androidScheme: "https",
    cleartext: serverUrl.startsWith("http://"),
    // Without this, a failed first load (no signal, a slow network timing
    // out) leaves the WebView empty behind the native splash forever, with
    // no way out short of killing the app. App Review hit exactly that on a
    // fresh install ("displayed indefinitely blank when app launched").
    // capacitor/www/index.html is the bundled offline screen with a retry.
    errorPath: "index.html",
  },
  android: {
    backgroundColor: chromeColor,
    path: isCustomer ? "android-app" : "android",
  },
  ios: {
    backgroundColor: chromeColor,
    // Matches the WebView's own scroll inset handling instead of double-
    // inset-ing under the notch/home indicator (native-bridge.tsx already
    // colors the status bar via the StatusBar plugin, same as Android).
    contentInset: "always",
    path: isCustomer ? "ios-app" : "ios",
  },
  plugins: {
    // Capacitor's own default here is launchAutoHide: true with a 3000ms
    // launchShowDuration — meaning the branded splash disappears on its own
    // clock, whether or not the page has actually finished loading. On a
    // cold launch over a real network (not the fast, cached reload of local
    // dev testing), the WebView regularly takes longer than 3s to fetch,
    // parse and hydrate, so the timer fired first: the branded splash
    // vanished, and the blank WebView background (ios.backgroundColor /
    // android.backgroundColor below) sat there exposed for however much
    // longer the real load took. false here means the splash only ever
    // comes down when native-bridge.tsx explicitly calls
    // SplashScreen.hide() — which only happens once the page has actually
    // loaded and that setup has finished — so there is never a blank gap
    // between "the branded splash was showing" and "real content is ready",
    // no matter how slow one particular launch is.
    SplashScreen: {
      launchAutoHide: false,
    },
    // Android 15+ makes edge-to-edge mandatory once targetSdk reaches 35+
    // (this project targets 36) — with no opt-out, the WebView draws behind
    // the status bar and gesture nav bar unless something applies real
    // insets. Capacitor's own built-in inset handling has known gaps (see
    // native-bridge.tsx's StatusBar usage, which still works for tinting);
    // this plugin replaces it with a more complete implementation, so its
    // own default handling is turned off here to avoid the two fighting.
    SystemBars: {
      insetsHandling: "disable",
    },
    EdgeToEdge: {
      backgroundColor: chromeColor,
      statusBarColor: chromeColor,
      navigationBarColor: chromeColor,
    },
  },
};

export default config;
