import AuthDeeplinkBridge from "./auth-deeplink-bridge";
import PartnerSplash from "./partner-splash";

// Wraps every /partner route — login, not-linked, welcome, and the whole
// (dashboard) group — so the launch splash (see partner-splash.tsx) plays
// once per open of the native Partner app regardless of which screen the URL
// actually resolves to (it is a no-op in a browser, which is what keeps
// andamango.in/partner painting the sign-in form straight away for an
// operator being onboarded), and so the Google sign-in deep link (see
// auth-deeplink-bridge.tsx) is
// caught even while still on /partner/login, before anyone's signed in.
// Everything auth-gated stays gated in its own nested layout; this one owns
// nothing else.
export default function PartnerRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <AuthDeeplinkBridge />
      <PartnerSplash />
      {children}
    </>
  );
}
