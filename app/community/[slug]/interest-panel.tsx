"use client";

// The free "I'm interested" sign-up. No payment, no seats — it records the
// details an organiser needs to run the activity safely (name, age/DOB, a
// number to reach you on, an emergency contact, and consent), then swaps in a
// confirmation with a button to join the organiser's WhatsApp group.
//
// Identity is the same anonymous session a booking uses: ensureSession() before
// the write, community_signup() (072) does the rest.

import { useState } from "react";
import { ensureSession } from "@/lib/supabase-browser";
import { submitInterest } from "@/lib/interest";
import type { CommunityService } from "@/lib/community";
import { CheckIcon, ChatIcon } from "@/app/icons";

const label = "text-[11.5px] font-bold text-muted";
const field =
  "h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-[14px] font-semibold outline-none focus:border-brand";

export default function InterestPanel({
  service,
  initialPhone,
}: {
  service: CommunityService;
  initialPhone: string | null;
}) {
  const [fullName, setFullName] = useState("");
  const [age, setAge] = useState("");
  const [dob, setDob] = useState("");
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [emName, setEmName] = useState("");
  const [emPhone, setEmPhone] = useState("");
  const [consent, setConsent] = useState(false);

  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<{ whatsappGroupUrl: string | null } | null>(null);

  const ageNum = age.trim() === "" ? null : parseInt(age, 10);
  const ageOk = ageNum === null || (!isNaN(ageNum) && ageNum >= 0 && ageNum <= 120);

  const ready =
    fullName.trim() !== "" &&
    (age.trim() !== "" || dob !== "") &&
    ageOk &&
    phone.trim() !== "" &&
    emName.trim() !== "" &&
    emPhone.trim() !== "" &&
    consent &&
    !busy;

  const change = (fn: () => void) => {
    fn();
    setProblem(null);
  };

  const submit = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setProblem(null);

    try {
      await ensureSession();

      const result = await submitInterest({
        slug: service.slug,
        fullName: fullName.trim(),
        age: ageNum,
        dateOfBirth: dob || null,
        phone: phone.trim(),
        emergencyContactName: emName.trim(),
        emergencyContactPhone: emPhone.trim(),
        consent,
      });

      if (!result.ok) {
        setProblem(result.message);
        setBusy(false);
        return;
      }

      setDone({ whatsappGroupUrl: result.whatsappGroupUrl });
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Something went wrong.");
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="mt-8 rounded-2xl border border-line bg-surface p-5 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand text-white">
          <CheckIcon size={26} />
        </span>
        <h2 className="font-display mt-3 text-[19px] font-bold tracking-tight">You&apos;re in</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed font-medium text-muted">
          {service.organizerName} has your details for{" "}
          <span className="font-bold text-ink">{service.name}</span> —{" "}
          {service.dayLabel} {service.dayNum}, {service.timeLabel}.
        </p>
        <p className="mt-1 text-[12.5px] leading-relaxed font-medium text-muted">
          Meet at {service.meetingPoint}.
          {service.whatToBring ? ` Bring: ${service.whatToBring}.` : ""}
        </p>

        {done.whatsappGroupUrl ? (
          <a
            href={done.whatsappGroupUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-brand text-[15px] font-bold text-white"
          >
            <ChatIcon size={18} />
            Join the WhatsApp group
          </a>
        ) : (
          <p className="mt-5 rounded-xl border border-sandline bg-sandsoft px-3.5 py-2.5 text-[12.5px] leading-relaxed font-medium text-sandink2">
            The organiser will message you on {phone.trim()} with the final details.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="mt-8">
      <h2 className="text-[12px] font-bold tracking-wider text-muted uppercase">I&apos;m interested</h2>
      <p className="mt-2 text-[12px] leading-relaxed font-medium text-muted">
        It&apos;s free — this just lets {service.organizerName} know you&apos;re coming and how to
        reach you.
      </p>

      <div className="mt-4 flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className={label}>Full name</span>
          <input
            value={fullName}
            onChange={(e) => change(() => setFullName(e.target.value))}
            placeholder="e.g. Arjun Rao"
            className={field}
          />
        </label>

        <div className="flex gap-3">
          <label className="flex flex-1 flex-col gap-1">
            <span className={label}>Age</span>
            <input
              type="number"
              inputMode="numeric"
              value={age}
              onChange={(e) => change(() => setAge(e.target.value))}
              placeholder="Age"
              className={field}
            />
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className={label}>or date of birth</span>
            <input
              type="date"
              value={dob}
              onChange={(e) => change(() => setDob(e.target.value))}
              className={field}
            />
          </label>
        </div>

        <label className="flex flex-col gap-1">
          <span className={label}>Phone / WhatsApp</span>
          <input
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            value={phone}
            onChange={(e) => change(() => setPhone(e.target.value))}
            placeholder="98765 43210"
            className={field}
          />
        </label>

        <div className="flex gap-3">
          <label className="flex flex-1 flex-col gap-1">
            <span className={label}>Emergency contact</span>
            <input
              value={emName}
              onChange={(e) => change(() => setEmName(e.target.value))}
              placeholder="Name"
              className={field}
            />
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className={label}>Their number</span>
            <input
              type="tel"
              inputMode="numeric"
              value={emPhone}
              onChange={(e) => change(() => setEmPhone(e.target.value))}
              placeholder="Phone"
              className={field}
            />
          </label>
        </div>

        <label className="mt-1 flex items-start gap-2.5">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => change(() => setConsent(e.target.checked))}
            className="mt-0.5 h-4 w-4 shrink-0"
          />
          <span className="text-[12px] leading-relaxed font-medium text-ink">
            I&apos;m taking part at my own risk, and I&apos;m happy for {service.organizerName} to
            hold these details and contact me about this activity.
          </span>
        </label>

        {problem && (
          <p className="rounded-xl border border-sandline bg-sandsoft px-3.5 py-2.5 text-[12.5px] leading-relaxed font-medium text-sandink2">
            {problem}
          </p>
        )}

        <button
          type="button"
          disabled={!ready}
          onClick={submit}
          className={`mt-1 h-13 w-full rounded-2xl text-[15px] font-bold ${
            ready ? "bg-brand text-white" : "bg-line text-muted"
          }`}
        >
          {busy ? "Sending…" : "I'm interested"}
        </button>
      </div>
    </div>
  );
}
