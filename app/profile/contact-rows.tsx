"use client";

// The two things the app actually stores about a traveller — a phone number
// and an email — both delivery addresses for a ticket, both editable here.
// Round-trips through lib/profile.ts (traveller_profiles + set_my_* RPCs).
// Not the same as <PhonePrompt>/<EmailPrompt>, whose copy is tied to the
// booking-confirmation moment.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveMyPhone, saveMyEmail } from "@/lib/profile";
import { prettyPhone } from "@/lib/phone";
import { ChevronIcon, MailIcon, PhoneIcon } from "@/app/icons";

function Row({
  label,
  Icon,
  value,
  placeholder,
  inputProps,
  onSave,
}: {
  label: string;
  Icon: (p: { size?: number }) => React.JSX.Element;
  value: string | null;
  placeholder: string;
  inputProps: React.InputHTMLAttributes<HTMLInputElement>;
  onSave: (raw: string) => Promise<{ ok: boolean; message?: string }>;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async () => {
    if (busy || draft.trim() === "") return;
    setBusy(true);
    setProblem(null);
    const result = await onSave(draft);
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message ?? "Couldn't save that.");
      return;
    }
    setEditing(false);
    setDraft("");
    router.refresh();
  };

  return (
    <div className="rounded-[18px] border border-line bg-surface p-3.5">
      <button
        type="button"
        onClick={() => {
          setEditing((e) => !e);
          setDraft(value ?? "");
          setProblem(null);
        }}
        className="flex w-full items-center gap-3 text-left"
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px] bg-brandsoft text-brand">
          <Icon size={20} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-bold">{label}</span>
          <span className="mt-0.5 block truncate text-[12px] font-medium text-muted">
            {value ?? placeholder}
          </span>
        </span>
        <ChevronIcon
          size={18}
          className={`shrink-0 text-muted transition ${editing ? "rotate-90" : ""}`}
        />
      </button>

      {editing && (
        <div className="mt-3 border-t border-hairline pt-3">
          <div className="flex gap-2">
            <input
              {...inputProps}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3.5 text-[15px] font-semibold outline-none focus:border-brand"
            />
            <button
              type="button"
              disabled={busy || draft.trim() === ""}
              onClick={submit}
              className="h-11 shrink-0 rounded-xl bg-brand px-5 text-[14px] font-bold text-white disabled:bg-line disabled:text-muted"
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
          {problem && <p className="mt-2 text-[12px] font-medium text-warn">{problem}</p>}
        </div>
      )}
    </div>
  );
}

export default function ContactRows({
  initialPhone,
  initialEmail,
}: {
  initialPhone: string | null;
  initialEmail: string | null;
}) {
  return (
    <div className="mt-3 flex flex-col gap-2.5">
      <Row
        label="Phone"
        Icon={PhoneIcon}
        value={initialPhone ? prettyPhone(initialPhone) : null}
        placeholder="Add your number"
        inputProps={{
          type: "tel",
          inputMode: "numeric",
          autoComplete: "tel",
          placeholder: "98765 43210",
          "aria-label": "Your mobile number",
        }}
        onSave={saveMyPhone}
      />
      <Row
        label="Email"
        Icon={MailIcon}
        value={initialEmail}
        placeholder="Add an email"
        inputProps={{
          type: "email",
          autoComplete: "email",
          placeholder: "you@example.com",
          "aria-label": "Your email address",
        }}
        onSave={saveMyEmail}
      />
    </div>
  );
}
