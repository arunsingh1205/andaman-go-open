"use client";

// A second delivery address, next to the phone prompt. No proof of
// ownership needed here — we just want somewhere else to send the booking
// details, so this saves straight away like the phone number does.

import { useState } from "react";
import { saveMyEmail } from "@/lib/profile";
import { CheckIcon, ChatIcon } from "@/app/icons";

export default function EmailPrompt({ initialEmail }: { initialEmail: string | null }) {
  const [saved, setSaved] = useState<string | null>(initialEmail);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async () => {
    if (busy || value.trim() === "") return;

    setBusy(true);
    setProblem(null);

    const result = await saveMyEmail(value);

    if (!result.ok) {
      setProblem(result.message);
      setBusy(false);
      return;
    }

    setSaved(result.email);
    setEditing(false);
    setBusy(false);
    setValue("");
  };

  if (saved && !editing) {
    return (
      <div className="mt-3 flex items-center gap-3 rounded-[18px] border border-line bg-brandsoft p-4">
        <CheckIcon size={18} className="shrink-0 text-brand" />
        <p className="min-w-0 flex-1 text-[13px] leading-snug font-medium">
          We&apos;ll also email your ticket to{" "}
          <span className="font-bold">{saved}</span>
        </p>
        <button
          type="button"
          onClick={() => {
            setEditing(true);
            setValue(saved);
          }}
          className="shrink-0 text-[12.5px] font-bold text-brand underline underline-offset-2"
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-[18px] border border-line bg-surface p-4">
      <p className="flex items-center gap-2 text-[10.5px] font-bold tracking-wider text-muted uppercase">
        <ChatIcon size={15} />
        Also by email
      </p>
      <h2 className="mt-1.5 text-[15px] leading-snug font-bold">
        Want a copy of your ticket by email too?
      </h2>

      <div className="mt-3.5 flex gap-2">
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="you@example.com"
          aria-label="Your email address"
          className="h-12 min-w-0 flex-1 rounded-xl border border-line bg-ground px-3.5 text-[15px] font-semibold outline-none focus:border-brand"
        />
        <button
          type="button"
          disabled={busy || value.trim() === ""}
          onClick={submit}
          className="h-12 shrink-0 rounded-xl bg-brand px-5 text-[14px] font-bold text-white disabled:bg-line disabled:text-muted"
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>

      {problem && <p className="mt-2 text-[12px] font-medium text-warn">{problem}</p>}

      {saved && (
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="mt-2.5 text-[12.5px] font-semibold text-sandink2 underline underline-offset-2"
        >
          Keep {saved}
        </button>
      )}
    </div>
  );
}
