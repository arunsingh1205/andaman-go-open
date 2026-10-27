import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Bricolage_Grotesque } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { IslandProvider } from "@/lib/island-context";
import { getSeaReports } from "@/lib/sea-report";
import { SITE_URL } from "@/lib/seo";
import SessionBoot from "./session-boot";
import NativeBridge from "./native-bridge";
import DesktopNav from "./desktop-nav";
import LocationBootstrap from "./location-bootstrap";
import VisitBeacon from "./visit-beacon";
import GoogleAnalytics from "./google-analytics";
import MetaPixel from "./meta-pixel";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-jakarta" });
const bricolage = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-bricolage" });

// The tab icon, home-screen icon and link-preview card come from the files
// beside this one — app/icon.png, app/apple-icon.png, app/favicon.ico and
// app/opengraph-image.png. Next wires those up by filename; metadataBase is
// what turns the preview image into the absolute URL that scrapers need.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Andaman Go",
  // The fallback for any page without a description of its own.
  description:
    "Book scuba dives, snorkelling, cabs, scooters, stays and island day trips across Port Blair, Havelock and Neil — directly from licence-checked local operators.",
  applicationName: "Andaman Go",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Andaman Go" },
  openGraph: {
    siteName: "Andaman Go",
    type: "website",
    locale: "en_IN",
  },
  twitter: { card: "summary_large_image" },
};

// viewport-fit=cover lets a native shell run the webview edge to edge; screens
// pad themselves back past the notch and home indicator with the --safe-top /
// --safe-bottom vars (both 0 in a normal browser, so nothing shifts there).
// Locking scale keeps a double-tap or pinch from zooming the UI like a page.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#F2F6F5",
};

// This layout must never touch a request-scoped API — no cookies(), no
// headers(), no searchParams. It is the root, so anything dynamic in here
// opts *every* route in the app out of static rendering, including the two
// that have no per-request content at all: the marketing page at / and the
// coming-soon page at /soon. That is exactly what used to happen — an
// `await currentIslandId()` here (it calls cookies()) is why every HTML
// response came back `Cache-Control: no-store` with `X-Vercel-Cache: MISS`
// and cost a full server render in Virginia, ~500ms, for a page that is the
// same bytes for everybody. The island cookie is now read on the client, in
// lib/island-context.tsx — see the note there.
//
// getSeaReports() is fine to keep: it is a plain fetch() with
// `next: { revalidate: 1800 }`, which is cacheable rather than dynamic, so
// it makes this layout ISR on a 30-minute window instead of forcing it
// per-request. The marine forecast is the same for every visitor anyway.
//
// The traveller routes (/explore, /activities, /scooty…) are unaffected —
// each one reads the cookie itself via currentIslandSlug() and is
// force-dynamic on its own terms.
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const seaReports = await getSeaReports();

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${jakarta.variable} ${bricolage.variable}`}>
        <SessionBoot />
        <NativeBridge />
        <IslandProvider seaReports={seaReports}>
          <LocationBootstrap />
          <DesktopNav />
          {children}
        </IslandProvider>
        <Analytics />
        <VisitBeacon />
        <GoogleAnalytics />
        <MetaPixel />
      </body>
    </html>
  );
}