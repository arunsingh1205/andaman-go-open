"use client";

// The in-app half of account deletion — App Store Review Guideline 5.1.1(v).
//
// Rendered in two places, one per app, so neither ever has to send the person
// out to a mail client:
//   - the /delete-account policy page, which the traveller app links to from
//     Profile (the page already explains what is deleted and what is kept);
//   - partner Settings, inline, so the partner dashboard keeps its own flow
//     inside /partner.
//
// Two taps by design: deletion is irreversible for the person asking, and a
// single mis-tap next to "Log out" would be a bad day. The reason box is
// optional and never blocks the request.

import { useState } from "react";
import { requestAccountDeletion } from "@/lib/account-deletion";

export default function DeleteAccountRequest({
  account,
}: {
  account: "traveller" | "partner";
}) {
  const [stage, setStage] = useState<"idle" | "confirming" | "done">("idle");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const res = await requestAccountDeletion(account, reason);
    setBusy(false);
    if (res.ok) setStage("done");
    else setError(res.message);
  };

  if (stage === "done") {
    return (
      <div className="mt-4 rounded-2xl border border-line bg-surface p-4">
        <p className="text-[14px] font-bold">Deletion requested</p>
        <p className="mt-1 text-[12.5px] leading-relaxed font-medium text-muted">
          We&apos;ve received it and will confirm by email. Your account and the personal
          data tied to it are deleted within 30 days. Booking and payment records for
          completed transactions are kept only for as long as Indian tax law requires.
        </p>
      </div>
    );
  }

  if (stage === "idle") {
    return (
      <button
        type="button"
        onClick={() => setStage("confirming")}
        className="mt-4 flex h-11 w-full items-center justify-center rounded-xl border border-line bg-surface text-[13.5px] font-bold text-warn"
      >
        Delete my account
      </button>
    );
  }

  return (
    <div className="mt-4 rounded-2xl border border-sandline bg-sandsoft p-4">
      <p className="text-[12.5px] leading-relaxed font-medium text-sandink2">
        This starts deletion of your account and the personal data on it. It can&apos;t
        be undone, and any upcoming bookings will be cancelled.
      </p>
      <label className="mt-3 block">
        <span className="text-[11px] font-bold tracking-wide text-muted uppercase">
          Reason (optional)
        </span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          maxLength={500}
          className="mt-1 w-full rounded-xl border border-line bg-surface p-2.5 text-[13px] font-medium"
        />
      </label>
      {error && <p className="mt-2 text-[12px] font-semibold text-warn">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={submit}
          className="h-11 flex-1 rounded-xl bg-warn text-[13.5px] font-bold text-white disabled:opacity-60"
        >
          {busy ? "Sending…" : "Delete my account"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setStage("idle")}
          className="h-11 rounded-xl border border-line bg-surface px-4 text-[13.5px] font-bold text-ink disabled:opacity-50"
        >
          Keep it
        </button>
      </div>
    </div>
  );
}
