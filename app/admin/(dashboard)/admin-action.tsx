"use client";

// Every destructive thing this console can do needs a reason, and needs to
// ask twice.
//
// Rejecting a business, suspending a live one, taking a listing down,
// cancelling somebody's booking — four different verbs, but the same shape:
// a button that doesn't fire on the first press, a box for the reason
// somebody else will read, and a confirm that stays disabled until it has
// something in it. That last part is a courtesy, not the enforcement: the
// database refuses an empty reason on all four RPCs, so a bug here can't
// produce a reason-less rejection.
//
// This exists because the old admin app had this logic written out twice
// already (partners-view and listings-view), and this round would have made
// it five times.

import { useState } from "react";
import { useRouter } from "next/navigation";

export type ActionResult = { ok: boolean; message: string };

export function ReasonAction({
  label,
  busyLabel,
  confirmLabel,
  prompt,
  placeholder,
  variant = "danger",
  onConfirm,
  size = "md",
}: {
  label: string;
  busyLabel: string;
  confirmLabel: string;
  /** The sentence above the box — say who reads it and what happens. */
  prompt: string;
  placeholder: string;
  variant?: "danger" | "quiet";
  onConfirm: (reason: string) => Promise<ActionResult>;
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const height = size === "sm" ? "h-9" : "h-10";
  const text = size === "sm" ? "text-[12.5px]" : "text-[13px]";

  const submit = async () => {
    if (reason.trim() === "" || busy) return;
    setBusy(true);
    setProblem(null);
    const result = await onConfirm(reason);
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    setOpen(false);
    setReason("");
    router.refresh();
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${height} ${text} shrink-0 rounded-button px-4 font-bold ${
          variant === "danger"
            ? "border border-line bg-surface text-warn hover:border-warn"
            : "border border-line bg-surface text-ink hover:border-brand"
        }`}
      >
        {label}
      </button>
    );
  }

  return (
    <div className="w-full rounded-panel border border-line bg-ground p-3">
      <p className="text-[12px] font-medium text-muted">{prompt}</p>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={placeholder}
        rows={2}
        autoFocus
        className="mt-2 w-full rounded-control border border-line bg-surface px-3 py-2 text-[13px] font-medium outline-none focus:border-brand"
      />
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={busy || reason.trim() === ""}
          onClick={submit}
          className={`${height} ${text} flex flex-1 items-center justify-center rounded-button bg-warn font-bold text-white disabled:bg-line disabled:text-muted`}
        >
          {busy ? busyLabel : confirmLabel}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setOpen(false);
            setReason("");
            setProblem(null);
          }}
          className={`${height} ${text} rounded-button border border-line bg-surface px-4 font-bold text-ink disabled:opacity-50`}
        >
          Never mind
        </button>
      </div>
      {problem && <p className="mt-2 text-[12px] font-bold text-warn">{problem}</p>}
    </div>
  );
}

/** The counterpart: a one-press action with nothing to explain. */
export function PlainAction({
  label,
  busyLabel,
  onRun,
  variant = "primary",
  size = "md",
}: {
  label: string;
  busyLabel: string;
  onRun: () => Promise<ActionResult>;
  variant?: "primary" | "quiet";
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const height = size === "sm" ? "h-9" : "h-10";
  const text = size === "sm" ? "text-[12.5px]" : "text-[13px]";

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const result = await onRun();
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    router.refresh();
  };

  return (
    <div className="shrink-0">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className={`${height} ${text} rounded-button px-4 font-bold ${
          variant === "primary"
            ? "bg-brand text-white disabled:bg-line disabled:text-muted"
            : "border border-line bg-surface text-ink hover:border-brand disabled:opacity-50"
        }`}
      >
        {busy ? busyLabel : label}
      </button>
      {problem && <p className="mt-1.5 text-[12px] font-bold text-warn">{problem}</p>}
    </div>
  );
}
