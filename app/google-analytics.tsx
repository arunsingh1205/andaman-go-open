// Google Analytics 4 for the website — and for the mobile apps, which are
// webview shells around this same site, so one Web stream sees both.
// GA4's enhanced measurement picks up client-side
// route changes on its own, so no per-navigation code is needed.

import Script from "next/script";

// The measurement ID is public by design (it ships in every page's HTML), so
// it lives here as the default; NEXT_PUBLIC_GA_ID overrides it per environment.
const GA_ID = process.env.NEXT_PUBLIC_GA_ID?.trim() || "G-1WBPBST9G7";

export default function GoogleAnalytics() {
  if (!GA_ID || !/^G-[A-Z0-9]+$/.test(GA_ID)) return null;
  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
      <Script id="ga4-init" strategy="afterInteractive">
        {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA_ID}');`}
      </Script>
    </>
  );
}
