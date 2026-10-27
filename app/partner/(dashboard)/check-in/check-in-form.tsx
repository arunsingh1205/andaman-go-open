"use client";

import { useState } from "react";
import { rupees } from "@/lib/activities";
import { KIND_LABEL } from "@/lib/bookings";
import { lookUpBooking, redeemBooking, type LookedUpBooking } from "@/lib/partner-redeem";
import { CameraIcon, CheckIcon, ClockIcon, QrIcon, RefundIcon } from "@/app/icons";
import QrScanner from "./qr-scanner";

type Stage =
  | { step: "idle" }
  | { step: "found"; booking: LookedUpBooking }
  | { step: "not-found"; message: string }
  | { step: "done"; message: string };

export default function CheckInForm() {
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<Stage>({ step: "idle" });
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);

  const lookUpCode = async (value: string) => {
    if (busy || value.trim() === "") return;
    setBusy(true);

    const result = await lookUpBooking(value);

    setBusy(false);
    setStage(
      result.found
        ? { step: "found", booking: result.booking }
        : { step: "not-found", message: result.message },
    );
  };

  const lookUp = () => lookUpCode(code);

  // A scanned code goes straight into the box and straight to a lookup — the
  // whole point of scanning is not having to also type it afterwards.
  const onScanned = (value: string) => {
    setScanning(false);
    setCode(value);
    lookUpCode(value);
  };

  const checkIn = async () => {
    if (busy) return;
    setBusy(true);

    const result = await redeemBooking(code);

    setBusy(false);
    setStage({ step: "done", message: result.message });
  };

  const reset = () => {
    setCode("");
    setStage({ step: "idle" });
  };

  return (
    <div className="mt-4">
      <div className="flex gap-2">
        <input
          type="text"
          autoCapitalize="characters"
          autoCorrect="off"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && lookUp()}
          placeholder="AG-6LWRM, or a ticket code"
          aria-label="Booking reference or ticket code"
          className="h-12 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3.5 text-[15px] font-semibold uppercase outline-none focus:border-brand"
        />
        <button
          type="button"
          disabled={busy || code.trim() === ""}
          onClick={lookUp}
          className="h-12 shrink-0 rounded-xl bg-brand px-5 text-[14px] font-bold text-white disabled:bg-line disabled:text-muted"
        >
          {busy && stage.step === "idle" ? "…" : "Look up"}
        </button>
      </div>

      <button
        type="button"
        onClick={() => setScanning(true)}
        className="mt-2.5 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-line bg-surface text-[13px] font-bold text-brand desk:w-auto desk:px-5"
      >
        <CameraIcon size={16} />
        Scan QR instead
      </button>

      {scanning && <QrScanner onDetected={onScanned} onClose={() => setScanning(false)} />}

      {stage.step === "not-found" && (
        <p className="mt-3 text-[12.5px] font-medium text-warn">{stage.message}</p>
      )}

      {stage.step === "found" && (
        <div className="mt-4 rounded-[18px] border border-line bg-surface p-4 shadow-sm">
          <p className="text-[11px] font-bold tracking-wider text-muted uppercase">
            {KIND_LABEL[stage.booking.kind]}
          </p>
          <p className="mt-0.5 text-[16px] leading-tight font-bold">{stage.booking.title}</p>
          <p className="mt-1.5 text-[12.5px] font-medium text-muted">
            {stage.booking.party} {stage.booking.party === 1 ? "guest" : "guests"} ·{" "}
            {stage.booking.refCode}
          </p>

          {stage.booking.balancePaise > 0 ? (
            <p className="mt-3 flex items-center gap-2 rounded-xl bg-sandsoft px-3.5 py-2.5 text-[13.5px] font-bold text-sandink2">
              <RefundIcon size={16} className="shrink-0" />
              Collect {rupees(stage.booking.balancePaise)} from the customer
            </p>
          ) : (
            <p className="mt-3 flex items-center gap-2 rounded-xl bg-brandsoft px-3.5 py-2.5 text-[13.5px] font-bold text-brand">
              <CheckIcon size={16} className="shrink-0" />
              Paid in full — nothing to collect
            </p>
          )}

          {stage.booking.redeemedAt ? (
            <p className="mt-3 flex items-center gap-1.5 text-[12.5px] font-semibold text-muted">
              <ClockIcon size={14} />
              Already checked in
            </p>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={checkIn}
              className="mt-3.5 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand text-[14px] font-bold text-white disabled:bg-line disabled:text-muted"
            >
              <QrIcon size={16} />
              {busy ? "Checking in…" : "Check in"}
            </button>
          )}

          <button
            type="button"
            onClick={reset}
            className="mt-2.5 text-[12.5px] font-semibold text-muted underline underline-offset-2"
          >
            Look up another
          </button>
        </div>
      )}

      {stage.step === "done" && (
        <div className="mt-4 rounded-[18px] border border-line bg-brandsoft p-4">
          <p className="flex items-start gap-2 text-[14.5px] leading-snug font-bold text-brand">
            <CheckIcon size={18} className="mt-0.5 shrink-0" />
            {stage.message}
          </p>
          <button
            type="button"
            onClick={reset}
            className="mt-3 flex h-11 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-[13px] font-bold text-brand"
          >
            Check in another
          </button>
        </div>
      )}
    </div>
  );
}
