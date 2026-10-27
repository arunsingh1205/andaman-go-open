"use client";

// The front door for every business on Andaman Go, and the first thing
// anybody who taps through to /partner sees. Laid out to match the
// onboarding design exactly: email + password is the primary, always-visible
// path; Google and Apple sit underneath as "or" options; "Create an account"
// below goes to the new self-serve sign-up flow (signup/signup-form.tsx).
//
// Apple sign-in exists alongside Google to satisfy App Store Guideline 4.8
// (any app offering a third-party sign-in must offer Sign in with Apple too)
// — it needs Supabase's Apple provider configured (Team ID, Services ID, Key
// ID, private key from a Sign in with Apple key) before it'll actually work;
// see MOBILE_APP_IOS.md.
//
// Both paths stay fully functional — this only changes which one reads as
// primary. Phone number sign-in, with an OTP, is intentionally not here yet
// — it waits on the same Twilio/WhatsApp work as the traveller side.

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { GoogleIcon, AppleIcon } from "@/app/icons";
import { MailGlyph, LockGlyph } from "../onboarding-icons";

export default function PartnerLoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [focus, setFocus] = useState<"email" | "password" | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // The traveller side hands this browser an anonymous account the moment
  // the app opens, and it's still sitting in the cookie jar when somebody
  // reaches this screen. Drop it before signing in for real, so the session
  // that comes back is unambiguously the account they just chose.
  const clearAnonymousSession = async () => {
    const { data } = await supabaseBrowser.auth.getSession();
    if (data.session?.user.is_anonymous) {
      await supabaseBrowser.auth.signOut({ scope: "local" });
    }
  };

  // Shared by Google and Apple: both consent screens refuse to render inside
  // a plain WebView, so the wrapped native app has to hand this off to a
  // real browser tab (@capacitor/browser) and get a deep link back — see
  // auth-deeplink-bridge.tsx's appUrlOpen listener for the other half of
  // this. A normal browser tab (mobile or desktop web) just navigates in
  // place, as it always has.
  const continueWithProvider = async (provider: "google" | "apple") => {
    if (busy) return;
    setBusy(true);
    setProblem(null);

    await clearAnonymousSession();

    const { Capacitor } = await import("@capacitor/core");
    const native = Capacitor.isNativePlatform();

    const { data, error } = await supabaseBrowser.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: native
          ? "com.andamango.partner://auth-callback"
          : `${window.location.origin}/partner/auth/callback`,
        ...(provider === "google" && { queryParams: { prompt: "select_account" } }),
        skipBrowserRedirect: native,
      },
    });

    if (error) {
      setProblem(`Couldn't reach ${provider === "google" ? "Google" : "Apple"}. Try again.`);
      setBusy(false);
      return;
    }

    if (native && data.url) {
      const { Browser } = await import("@capacitor/browser");
      await Browser.open({ url: data.url });
    }
    // On the web path, signInWithOAuth has already navigated the page to
    // the provider — nothing left to do here.
  };

  const submit = async () => {
    if (busy || email.trim() === "" || password === "") return;

    setBusy(true);
    setProblem(null);

    await clearAnonymousSession();

    const { error } = await supabaseBrowser.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      setProblem("That email and password don't match. Check them and try again.");
      setBusy(false);
      return;
    }

    // A full page load, not router.push: right after the session cookie
    // changes, a client-side navigation into (dashboard) rendered an empty
    // page and hung there with no error (the server's HTML was complete).
    // Same for every other post-sign-in jump on these screens.
    window.location.assign("/partner/bookings");
  };

  const border = (k: "email" | "password") => (focus === k ? "border-[#1F8A80]" : "border-[#E1E9E8]");

  return (
    <div className="relative min-h-dvh overflow-hidden bg-[#F4F8F7]">
      <div className="pointer-events-none absolute -top-[90px] -right-[90px] h-[260px] w-[260px] rounded-full bg-[#E3F4F1]" />
      <div className="pointer-events-none absolute top-[120px] right-10 h-[70px] w-[70px] rounded-full bg-[#7FD1C5] opacity-35" />

      <div className="relative mx-auto flex min-h-dvh w-full max-w-[430px] flex-col px-7 pt-[70px] pb-8">
        <Image
          sizes="170px"
          src="/brand/andaman-go-light-mode.png"
          alt="Andaman Go"
          width={1600}
          height={234}
          priority
          className="h-[30px] w-[170px]"
        />

        <div className="mt-auto pb-[18px]">
          <p className="text-[12px] font-bold tracking-widest text-[#1F8A80] uppercase">Partner</p>
          <h1 className="mt-2 text-[34px] leading-[1.1] font-extrabold tracking-[-1.2px] text-[#0F4C5C]">
            Welcome
            <br />
            back
          </h1>
          <p className="mt-3.5 text-[14px] leading-[1.55] text-[#6B8A90]">
            For the businesses that fulfil Andaman Go bookings. Dive shops, rentals, cabs,
            stays and more.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <label
            className={`flex h-[58px] items-center gap-3 rounded-[18px] border bg-white px-[18px] transition-colors ${border("email")}`}
          >
            <MailGlyph size={18} className="shrink-0 text-[#6B8A90]" />
            <input
              type="email"
              inputMode="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onFocus={() => setFocus("email")}
              onBlur={() => setFocus(null)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="Email address"
              aria-label="Email"
              className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold text-[#0F4C5C] outline-none placeholder:text-[#9DB3B7]"
            />
          </label>

          <label
            className={`flex h-[58px] items-center gap-3 rounded-[18px] border bg-white px-[18px] transition-colors ${border("password")}`}
          >
            <LockGlyph size={18} className="shrink-0 text-[#6B8A90]" />
            <input
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onFocus={() => setFocus("password")}
              onBlur={() => setFocus(null)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder="Password"
              aria-label="Password"
              className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold text-[#0F4C5C] outline-none placeholder:text-[#9DB3B7]"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="shrink-0 text-[12px] font-bold text-[#1F8A80]"
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </label>

          <div className="flex justify-end px-1">
            <Link href="/partner/help" className="text-[13px] font-bold text-[#0F4C5C]">
              Forgot password?
            </Link>
          </div>

          {problem && <p className="px-1 text-[12.5px] font-medium text-[#C2601F]">{problem}</p>}

          <button
            type="button"
            disabled={busy || email.trim() === "" || password === ""}
            onClick={submit}
            className="mt-1 flex h-[58px] w-full items-center justify-center rounded-[18px] bg-[#0F4C5C] text-[16px] font-bold text-white shadow-[0_12px_30px_rgba(15,76,92,0.25)] transition-colors hover:bg-[#1F8A80] disabled:bg-[#E1E9E8] disabled:text-[#9DB3B7] disabled:shadow-none"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>

          <div className="my-1.5 flex items-center gap-3">
            <span className="h-px flex-1 bg-[#DCE6E5]" />
            <span className="text-[12px] font-semibold text-[#9DB3B7]">or</span>
            <span className="h-px flex-1 bg-[#DCE6E5]" />
          </div>

          <button
            type="button"
            onClick={() => continueWithProvider("google")}
            disabled={busy}
            className="flex h-[58px] w-full items-center justify-center gap-3 rounded-[18px] border border-[#E1E9E8] bg-white text-[15px] font-bold text-[#0F4C5C] transition-colors hover:border-[#1F8A80] disabled:opacity-50"
          >
            <GoogleIcon size={20} />
            Continue with Google
          </button>

          <button
            type="button"
            onClick={() => continueWithProvider("apple")}
            disabled={busy}
            className="flex h-[58px] w-full items-center justify-center gap-3 rounded-[18px] border border-[#E1E9E8] bg-white text-[15px] font-bold text-[#0F4C5C] transition-colors hover:border-[#1F8A80] disabled:opacity-50"
          >
            <AppleIcon size={18} />
            Continue with Apple
          </button>
        </div>

        <p className="mt-auto pt-6 text-center text-[14px] text-[#6B8A90]">
          New partner?{" "}
          <Link href="/partner/signup" className="font-bold text-[#0F4C5C]">
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}
