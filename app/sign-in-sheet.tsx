"use client";

// The sign-in sheet. Phone first, because that is how people here actually
// identify themselves, and because it is the one method that needs no native
// plugin and no App Store rebuild.
//
// Google and Apple go in the slot marked below. They are deliberately not
// here yet: Google refuses to run its OAuth flow inside an embedded WebView
// (disallowed_useragent), so it needs a native plugin in the Capacitor
// project, and offering it at all triggers App Store Guideline 4.8, which
// then requires Sign in with Apple as well. Both mean a new iOS build. The
// layout leaves room so neither arrives as a redesign.
//
// Signing in is never a wall in front of a booking. You can book the whole
// way through as an anonymous account; this exists so the account stops being
// tied to one device's cookies.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { CloseIcon } from "@/app/icons";
import {
  completePhoneSignIn,
  normalisePhone,
  startPhoneSignIn,
  type SignInMode,
} from "@/lib/auth-phone";

const RESEND_SECONDS = 30;

export default function SignInSheet({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phoneInput, setPhoneInput] = useState("");
  const [phone, setPhone] = useState("");
  const [mode, setMode] = useState<SignInMode>("upgrade");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  // The resend timer. Twilio rejects a second send inside a minute anyway, so
  // showing the wait is kinder than showing a button that fails.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  useEffect(() => {
    if (step === "code") codeRef.current?.focus();
  }, [step]);

  const send = async () => {
    setBusy(true);
    setProblem(null);
    const result = await startPhoneSignIn(phoneInput);
    setBusy(false);

    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    setPhone(result.phone);
    setMode(result.mode);
    setStep("code");
    setCooldown(RESEND_SECONDS);
  };

  const verify = async () => {
    setBusy(true);
    setProblem(null);
    const result = await completePhoneSignIn(phone, code, mode);
    setBusy(false);

    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    // The server components on this page render from the cookie, which has
    // just changed identity — refresh before closing or Profile still shows
    // the old account for a beat.
    router.refresh();
    onClose();
  };

  const valid = normalisePhone(phoneInput) !== null;

  // Portalled straight onto <body>, not rendered in place inside
  // AccountRow/ProfilePage's tree. AccountRow sits inside <main>, a sibling
  // of the page's own <BottomNav />, and on-device this sheet's fixed z-50
  // was still ending up underneath the glass tab bar's z-40 — screenshots
  // showed "Couldn't send a code" cut off by the bottom nav bar rendering
  // on top of it. z-50 > z-40 should already win in the same stacking
  // context, so something in the surrounding tree (most likely WebKit's
  // well-known fixed-position/stacking quirks around the on-screen keyboard
  // opening and closing, which is exactly when this was seen) was putting
  // them in different ones. A portal onto body sidesteps whatever that
  // ancestor issue is rather than chasing it — the standard fix for "a
  // modal needs to unambiguously sit above everything else."
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center tablet:items-center">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-ink/40"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Log in"
        className="relative z-10 w-full max-w-[430px] rounded-t-sheet bg-surface px-5 pt-5 pb-[max(1.75rem,calc(var(--safe-bottom)+0.75rem))] tablet:max-w-[460px] tablet:rounded-sheet tablet:pb-7 tablet:shadow-float"
      >
        <div className="flex items-start gap-3 border-b border-hairline pb-4">
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-[17px] leading-tight font-bold tracking-tight">
              {step === "phone" ? "Log in" : "Enter the code"}
            </h2>
            <p className="mt-0.5 text-[12px] font-medium text-muted">
              {step === "phone"
                ? "So your bookings follow you to any phone."
                : `Texted to ${phone}`}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="-mt-1 -mr-2 flex h-11 w-11 shrink-0 items-center justify-center text-muted"
          >
            <CloseIcon size={20} />
          </button>
        </div>

        {step === "phone" ? (
          <>
            <label htmlFor="signin-phone" className="mt-4 block text-[12px] font-bold text-muted">
              Mobile number
            </label>
            <input
              id="signin-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              autoFocus
              value={phoneInput}
              onChange={(e) => setPhoneInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && valid && !busy) void send();
              }}
              placeholder="98765 43210"
              className="focus-ring mt-1.5 h-12 w-full rounded-xl border border-line bg-ground px-3.5 text-[16px] font-semibold"
            />

            <button
              type="button"
              disabled={!valid || busy}
              onClick={() => void send()}
              className="mt-3 h-12 w-full rounded-xl bg-brand text-[14.5px] font-bold text-white disabled:opacity-50"
            >
              {busy ? "Sending…" : "Send code"}
            </button>

            {/* ---------------------------------------------------------------
                Google and Apple go here, under a "or" divider, once the
                native sign-in plugins are in the iOS project. Linking them to
                an existing phone account is one call — linkIdentity() — so
                somebody who signed up by number keeps the same account and
                the same bookings when they later add Google.
            --------------------------------------------------------------- */}
          </>
        ) : (
          <>
            <label htmlFor="signin-code" className="mt-4 block text-[12px] font-bold text-muted">
              6-digit code
            </label>
            <input
              id="signin-code"
              ref={codeRef}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ""))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && code.length >= 4 && !busy) void verify();
              }}
              placeholder="······"
              className="focus-ring mt-1.5 h-12 w-full rounded-xl border border-line bg-ground px-3.5 text-center text-[20px] font-bold tracking-[0.4em]"
            />

            <button
              type="button"
              disabled={code.length < 4 || busy}
              onClick={() => void verify()}
              className="mt-3 h-12 w-full rounded-xl bg-brand text-[14.5px] font-bold text-white disabled:opacity-50"
            >
              {busy ? "Checking…" : "Log in"}
            </button>

            <div className="mt-3 flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  setStep("phone");
                  setCode("");
                  setProblem(null);
                }}
                className="text-[12.5px] font-bold text-muted"
              >
                Change number
              </button>
              <button
                type="button"
                disabled={cooldown > 0 || busy}
                onClick={() => void send()}
                className="text-[12.5px] font-bold text-brand disabled:text-muted"
              >
                {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
              </button>
            </div>

            {mode === "existing" && (
              <p className="mt-3 rounded-xl border border-sandline bg-sandsoft p-3 text-[12px] leading-relaxed font-medium text-sandink2">
                This number already has an account. Logging in switches to it —
                anything booked on this device without an account stays
                reachable with the reference code sent on WhatsApp.
              </p>
            )}
          </>
        )}

        {problem && (
          <p className="mt-3 text-[12.5px] font-semibold text-warn" role="alert">
            {problem}
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
}
