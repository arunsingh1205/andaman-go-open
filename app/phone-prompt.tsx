"use client";

// "Where should we send your ticket?"
//
// This sits on the confirmation screen, after the booking already exists, and
// that placement is the whole design. Ask before the booking and it reads as a
// sign-up wall, and people leave. Ask after, and it reads as an address — same
// field, same data, and nobody thinks twice about it.
//
// OTP verification (115, lib/phone-otp.ts) slots in right after Save: a code
// is texted to the number just entered, and the prompt doesn't count it as
// done until that code comes back correct. It only runs once, right when a
// number is first added or changed — not on every visit.

import { useState } from "react";
import { sendPhoneOtp, checkPhoneOtp } from "@/lib/phone-otp";
import { CheckIcon, ChatIcon } from "@/app/icons";

/** +919876543210 → +91 98765 43210 */
function pretty(phone: string): string {
  const indian = phone.match(/^\+91(\d{5})(\d{5})$/);
  return indian ? `+91 ${indian[1]} ${indian[2]}` : phone;
}

type Stage = "form" | "otp";

export default function PhonePrompt({
  initialPhone,
  initialVerified,
}: {
  initialPhone: string | null;
  initialVerified: boolean;
}) {
  const [phone, setPhone] = useState<string | null>(initialPhone);
  const [verified, setVerified] = useState(initialVerified);
  const [stage, setStage] = useState<Stage | null>(initialPhone ? null : "form");

  const [value, setValue] = useState("");
  const [code, setCode] = useState("");
  const [pendingPhone, setPendingPhone] = useState<string | null>(null);

  const [busy, setBusy] = useState<"send" | "check" | "resend" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  const requestCode = async (raw: string) => {
    setBusy("send");
    setProblem(null);
    const result = await sendPhoneOtp(raw);
    setBusy(null);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    setPhone(result.phone);
    setPendingPhone(result.phone);
    setVerified(false);
    setStage("otp");
    setCode("");
  };

  const submitForm = () => {
    if (busy || value.trim() === "") return;
    requestCode(value);
  };

  const resend = async () => {
    if (!pendingPhone || busy) return;
    setBusy("resend");
    setProblem(null);
    const result = await sendPhoneOtp(pendingPhone);
    setBusy(null);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    setResent(true);
    setTimeout(() => setResent(false), 2500);
  };

  const submitCode = async () => {
    if (!pendingPhone || busy || code.trim() === "") return;
    setBusy("check");
    setProblem(null);
    const result = await checkPhoneOtp(pendingPhone, code.trim());
    setBusy(null);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    setVerified(true);
    setStage(null);
    setCode("");
  };

  // Verified — the settled state, same copy as before.
  if (phone && verified && stage === null) {
    return (
      <div className="mt-5 flex items-center gap-3 rounded-[18px] border border-line bg-brandsoft p-4">
        <CheckIcon size={18} className="shrink-0 text-brand" />
        <p className="min-w-0 flex-1 text-[13px] leading-snug font-medium">
          Your ticket is going to{" "}
          <span className="font-bold">{pretty(phone)}</span>
        </p>
        <button
          type="button"
          onClick={() => {
            setStage("form");
            setValue(phone);
            setProblem(null);
          }}
          className="shrink-0 text-[12.5px] font-bold text-brand underline underline-offset-2"
        >
          Change
        </button>
      </div>
    );
  }

  // Saved but not yet verified — a nudge to finish, not a repeat of the ask.
  if (phone && !verified && stage === null) {
    return (
      <div className="mt-5 rounded-[18px] border border-sandline bg-sandsoft p-4">
        <p className="text-[13px] leading-snug font-medium text-sandink2">
          Your ticket is going to <span className="font-bold">{pretty(phone)}</span> — not
          verified yet.
        </p>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={busy === "send"}
            onClick={() => requestCode(phone)}
            className="h-10 rounded-xl bg-brand px-4 text-[12.5px] font-bold text-white disabled:bg-line disabled:text-muted"
          >
            {busy === "send" ? "Sending…" : "Verify number"}
          </button>
          <button
            type="button"
            onClick={() => {
              setStage("form");
              setValue(phone);
              setProblem(null);
            }}
            className="text-[12.5px] font-bold text-sandink2 underline underline-offset-2"
          >
            Change
          </button>
        </div>
        {problem && <p className="mt-2 text-[12px] font-medium text-warn">{problem}</p>}
      </div>
    );
  }

  // Entering / changing the number.
  if (stage === "form") {
    return (
      <div className="mt-5 rounded-[18px] border border-sandline bg-sandsoft p-4">
        <p className="flex items-center gap-2 text-[10.5px] font-bold tracking-wider text-sandink uppercase">
          <ChatIcon size={15} />
          One last thing
        </p>

        <h2 className="mt-1.5 text-[15px] leading-snug font-bold text-sandink">
          Where should we send your ticket?
        </h2>
        <p className="mt-1.5 text-[12.5px] leading-relaxed font-medium text-sandink2">
          We&apos;ll text a code to check it&apos;s really your number, then send the ticket there
          and message it if the weather changes anything. Your booking is already held either
          way.
        </p>

        <div className="mt-3.5 flex gap-2">
          <input
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitForm()}
            placeholder="98765 43210"
            aria-label="Your mobile number"
            className="h-12 min-w-0 flex-1 rounded-xl border border-sandline bg-surface px-3.5 text-[15px] font-semibold outline-none focus:border-brand"
          />
          <button
            type="button"
            disabled={busy === "send" || value.trim() === ""}
            onClick={submitForm}
            className="h-12 shrink-0 rounded-xl bg-brand px-5 text-[14px] font-bold text-white disabled:bg-line disabled:text-muted"
          >
            {busy === "send" ? "Sending…" : "Send code"}
          </button>
        </div>

        {problem && <p className="mt-2 text-[12px] font-medium text-warn">{problem}</p>}

        {phone && (
          <button
            type="button"
            onClick={() => {
              setStage(null);
              setProblem(null);
            }}
            className="mt-2.5 text-[12.5px] font-semibold text-sandink2 underline underline-offset-2"
          >
            Keep {pretty(phone)}
          </button>
        )}
      </div>
    );
  }

  // Code entry.
  return (
    <div className="mt-5 rounded-[18px] border border-sandline bg-sandsoft p-4">
      <p className="flex items-center gap-2 text-[10.5px] font-bold tracking-wider text-sandink uppercase">
        <ChatIcon size={15} />
        Verify your number
      </p>
      <h2 className="mt-1.5 text-[15px] leading-snug font-bold text-sandink">
        Enter the code we sent to {pendingPhone ? pretty(pendingPhone) : "your number"}
      </h2>

      <div className="mt-3.5 flex gap-2">
        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ""))}
          onKeyDown={(e) => e.key === "Enter" && submitCode()}
          placeholder="6-digit code"
          aria-label="Verification code"
          maxLength={6}
          className="h-12 min-w-0 flex-1 rounded-xl border border-sandline bg-surface px-3.5 text-[15px] font-semibold tracking-widest outline-none focus:border-brand"
        />
        <button
          type="button"
          disabled={busy === "check" || code.trim() === ""}
          onClick={submitCode}
          className="h-12 shrink-0 rounded-xl bg-brand px-5 text-[14px] font-bold text-white disabled:bg-line disabled:text-muted"
        >
          {busy === "check" ? "Checking…" : "Verify"}
        </button>
      </div>

      {problem && <p className="mt-2 text-[12px] font-medium text-warn">{problem}</p>}
      {resent && <p className="mt-2 text-[12px] font-medium text-brand">Code resent.</p>}

      <div className="mt-2.5 flex gap-4">
        <button
          type="button"
          disabled={busy === "resend"}
          onClick={resend}
          className="text-[12.5px] font-semibold text-sandink2 underline underline-offset-2 disabled:opacity-50"
        >
          {busy === "resend" ? "Resending…" : "Resend code"}
        </button>
        <button
          type="button"
          onClick={() => {
            setStage("form");
            setValue(pendingPhone ?? "");
            setProblem(null);
          }}
          className="text-[12.5px] font-semibold text-sandink2 underline underline-offset-2"
        >
          Change number
        </button>
      </div>
    </div>
  );
}
