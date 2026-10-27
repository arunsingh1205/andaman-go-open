"use client";

// Step 1 of 2 in the self-serve path: create the account. Step 2 is
// registering the business, which already exists at /partner/not-linked —
// this screen's "Continue" lands there once Supabase has a session.
//
// This is a new capability, not previously in the app: the only other sign-in
// paths are Google OAuth (self-serve) and email+password logins Andaman Go
// sets up by hand. This adds real self-serve email+password signup via
// Supabase's own auth.signUp — no separate account system, no custom
// password handling.

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { ChevronLeftGlyph, MailGlyph, LockGlyph, UserGlyph, ArrowRightGlyph, CheckGlyph } from "../onboarding-icons";

type Field = "name" | "email" | "phone" | "password";

const STRENGTH_COLORS = ["#FF7A59", "#F4B860", "#7FD1C5", "#1F8A80"];
const STRENGTH_LABELS = ["Weak", "Weak", "Fair", "Good", "Strong"];

function passwordScore(pw: string) {
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return score;
}

export default function PartnerSignupForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [agree, setAgree] = useState(false);
  const [focus, setFocus] = useState<Field | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);

  const border = (k: Field) => (focus === k ? "border-[#1F8A80]" : "border-[#E1E9E8]");
  const score = passwordScore(password);
  const strength = [0, 1, 2, 3].map((i) => (i < score ? STRENGTH_COLORS[Math.max(score - 1, 0)] : "#E1E9E8"));
  const strengthLabel = password ? STRENGTH_LABELS[score] : "";

  const ready = name.trim() !== "" && email.trim() !== "" && score >= 2 && agree;

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setProblem(null);

    const { data } = await supabaseBrowser.auth.getSession();
    if (data.session?.user.is_anonymous) {
      await supabaseBrowser.auth.signOut({ scope: "local" });
    }

    const { data: signUpData, error } = await supabaseBrowser.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { full_name: name.trim(), phone: phone.trim() || null },
        emailRedirectTo: `${window.location.origin}/partner/auth/callback`,
      },
    });

    if (error) {
      setProblem(
        error.message.toLowerCase().includes("already registered")
          ? "That email already has an account. Try signing in instead."
          : error.message,
      );
      setBusy(false);
      return;
    }

    if (signUpData.session) {
      window.location.assign("/partner/not-linked");
      return;
    }

    // No session back means Supabase is waiting on email confirmation
    // before it will sign this account in.
    setCheckEmail(true);
    setBusy(false);
  };

  if (checkEmail) {
    return (
      <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-[#0F4C5C] px-7 text-center text-white">
        <div className="pointer-events-none absolute -top-[60px] -right-[60px] h-[200px] w-[200px] rounded-full bg-[#1F8A80] opacity-50" />
        <span className="flex h-20 w-20 items-center justify-center rounded-full bg-[#7FD1C5]">
          <MailGlyph size={30} className="text-[#0F4C5C]" />
        </span>
        <h1 className="mt-8 text-[24px] font-extrabold tracking-[-0.8px]">Check your email</h1>
        <p className="mt-3 max-w-[280px] text-[14px] leading-relaxed text-[#A9DDD5]">
          We sent a confirmation link to {email}. Open it, then come back and sign in.
        </p>
        <Link
          href="/partner/login"
          className="mt-8 flex h-[54px] w-full max-w-[280px] items-center justify-center rounded-[18px] bg-[#7FD1C5] text-[15px] font-extrabold text-[#0F4C5C]"
        >
          Go to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-[#F4F8F7]">
      <div className="relative overflow-hidden bg-[#0F4C5C] px-7 tablet:px-[max(1.75rem,calc((100%-560px)/2))] pt-16 pb-[34px] text-white">
        <div className="pointer-events-none absolute -top-[60px] -right-[60px] h-[200px] w-[200px] rounded-full bg-[#1F8A80] opacity-50" />
        <div className="pointer-events-none absolute right-[60px] -bottom-[60px] h-[120px] w-[120px] rounded-full bg-[#7FD1C5] opacity-[0.18]" />

        <div className="relative flex items-center justify-between">
          <Link
            href="/partner/login"
            aria-label="Back"
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/12"
          >
            <ChevronLeftGlyph size={18} className="text-white" />
          </Link>
          <Image
            sizes="123px"
            src="/brand/andaman-go-dark-mode.png"
            alt="Andaman Go"
            width={1600}
            height={234}
            className="h-[18px] w-auto"
          />
          <div className="w-10" />
        </div>

        <div className="relative mt-[30px]">
          <p className="text-[12px] font-bold tracking-widest text-[#7FD1C5] uppercase">Step 1 of 2</p>
          <h1 className="mt-2 text-[30px] leading-[1.1] font-extrabold tracking-[-1px]">Become a partner</h1>
          <p className="mt-2.5 text-[14px] leading-[1.5] text-[#A9DDD5]">
            Create your account, then register your business on the next screen.
          </p>
        </div>

        <div className="relative mt-[22px] flex gap-1.5">
          <span className="h-[5px] flex-1 rounded-full bg-[#7FD1C5]" />
          <span className="h-[5px] flex-1 rounded-full bg-white/[0.18]" />
        </div>
      </div>

      <div className="flex flex-1 flex-col overflow-auto px-7 pt-[26px] tablet:px-[max(1.75rem,calc((100%-560px)/2))]">
        <div className="flex flex-col gap-3">
          <label className={`flex h-[58px] items-center gap-3 rounded-[18px] border bg-white px-[18px] ${border("name")}`}>
            <UserGlyph size={18} className="shrink-0 text-[#6B8A90]" />
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onFocus={() => setFocus("name")}
              onBlur={() => setFocus(null)}
              placeholder="Full name"
              className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold text-[#0F4C5C] outline-none placeholder:text-[#9DB3B7]"
            />
          </label>

          <label className={`flex h-[58px] items-center gap-3 rounded-[18px] border bg-white px-[18px] ${border("email")}`}>
            <MailGlyph size={18} className="shrink-0 text-[#6B8A90]" />
            <input
              type="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onFocus={() => setFocus("email")}
              onBlur={() => setFocus(null)}
              placeholder="Email address"
              className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold text-[#0F4C5C] outline-none placeholder:text-[#9DB3B7]"
            />
          </label>

          <label className={`flex h-[58px] items-center gap-3 rounded-[18px] border bg-white px-[18px] ${border("phone")}`}>
            <span className="border-r border-[#E1E9E8] pr-3 text-[15px] font-bold text-[#0F4C5C]">+91</span>
            <input
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onFocus={() => setFocus("phone")}
              onBlur={() => setFocus(null)}
              placeholder="Mobile number"
              className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold text-[#0F4C5C] outline-none placeholder:text-[#9DB3B7]"
            />
          </label>

          <label className={`flex h-[58px] items-center gap-3 rounded-[18px] border bg-white px-[18px] ${border("password")}`}>
            <LockGlyph size={18} className="shrink-0 text-[#6B8A90]" />
            <input
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onFocus={() => setFocus("password")}
              onBlur={() => setFocus(null)}
              placeholder="Create password"
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

          <div className="flex items-center gap-1.5 px-1">
            {strength.map((c, i) => (
              <span key={i} className="h-1 flex-1 rounded-full" style={{ background: c }} />
            ))}
            <span className="ml-2 min-w-[48px] text-right text-[11px] font-bold text-[#6B8A90]">
              {strengthLabel}
            </span>
          </div>
        </div>

        <label className="mt-[22px] flex cursor-pointer items-start gap-3">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="peer sr-only" />
          <span className="mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[7px] border-[1.5px] border-[#C9D9D7] bg-white transition-colors peer-checked:border-[#1F8A80] peer-checked:bg-[#1F8A80]">
            <CheckGlyph size={12} className="text-white" />
          </span>
          <span className="text-[13px] leading-[1.5] text-[#6B8A90]">
            I agree to the{" "}
            <Link href="/partner-agreement" target="_blank" rel="noopener noreferrer" className="font-bold text-[#0F4C5C]">
              Partner Terms
            </Link>{" "}
            and{" "}
            <Link href="/privacy" target="_blank" rel="noopener noreferrer" className="font-bold text-[#0F4C5C]">
              Privacy Policy
            </Link>
            .
          </span>
        </label>

        {problem && <p className="mt-3 text-[12.5px] font-medium text-[#C2601F]">{problem}</p>}

        <div className="mt-auto flex flex-col gap-5 py-[22px]">
          <button
            type="button"
            disabled={!ready || busy}
            onClick={submit}
            className="flex h-[58px] w-full items-center justify-center gap-2 rounded-[18px] bg-[#0F4C5C] text-[16px] font-bold text-white shadow-[0_12px_30px_rgba(15,76,92,0.2)] transition-colors disabled:bg-[#9DB3B7] disabled:shadow-none"
          >
            {busy ? "Creating account…" : "Continue"}
            {!busy && <ArrowRightGlyph size={18} />}
          </button>
          <p className="text-center text-[14px] text-[#6B8A90]">
            Already a partner?{" "}
            <Link href="/partner/login" className="font-bold text-[#0F4C5C]">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
