"use client";

// A partner's own settlement history — read-only, across every category.
// Andaman Go runs the batch and marks it paid from the admin console (101);
// this just makes the money trail visible on this side too.

import { useState } from "react";
import { rupees } from "@/lib/activities";
import type { SettlementBatch } from "@/lib/partner-settlements";
import { CheckIcon, ClockIcon } from "@/app/icons";

export default function SettlementsView({ batches }: { batches: SettlementBatch[] }) {
  const [filter, setFilter] = useState<"all" | "pending" | "paid">("all");
  const shown = batches.filter((b) => filter === "all" || b.status === filter);
  const totalPending = batches
    .filter((b) => b.status === "pending")
    .reduce((s, b) => s + b.netPayablePaise, 0);

  return (
    <>
      <h2 className="font-display text-[20px] font-bold tracking-tight">Settlements</h2>
      <p className="mt-1 text-[12.5px] font-medium text-muted">
        When a traveller pays online — in full, or a deposit — Andaman Go holds your share until
        it&apos;s delivered, then pays it out weekly.
      </p>

      <div className="mt-4 rounded-2xl border border-brandsoft bg-brandsoft p-4">
        <p className="text-[11px] font-bold tracking-wider text-brand uppercase">Owed to you</p>
        <p className="font-display mt-1 text-[26px] font-bold tracking-tight text-brand">
          {rupees(totalPending)}
        </p>
      </div>

      <div className="mt-4 flex gap-2">
        {(["all", "pending", "paid"] as const).map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={`h-9 rounded-full border px-3.5 text-[12.5px] font-semibold capitalize ${
              filter === f ? "border-brand bg-brand text-white" : "border-line bg-surface text-muted"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <ul className="mt-3 flex flex-col gap-2.5">
        {shown.map((b) => (
          <li key={b.id} className="rounded-[16px] border border-line bg-surface p-3.5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13.5px] font-bold">
                  {b.periodStart} → {b.periodEnd}
                </p>
                <p className="text-[11.5px] font-medium text-muted">
                  {b.itemCount} booking{b.itemCount === 1 ? "" : "s"} · gross {rupees(b.grossPaise)} · commission{" "}
                  {rupees(b.commissionPaise)}
                </p>
              </div>
              <span
                className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[10.5px] font-bold ${
                  b.status === "paid" ? "bg-brandsoft text-brand" : "bg-sandsoft text-sandink2"
                }`}
              >
                {b.status === "paid" ? <CheckIcon size={11} /> : <ClockIcon size={11} />}
                {b.status === "paid" ? "Paid" : "Pending"}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between border-t border-hairline pt-2">
              <span className="text-[12px] font-medium text-muted">Net payable</span>
              <span className="text-[15px] font-bold">{rupees(b.netPayablePaise)}</span>
            </div>
            {b.status === "paid" && b.payoutReference && (
              <p className="mt-1 text-[11px] font-medium text-muted">Ref: {b.payoutReference}</p>
            )}
          </li>
        ))}
        {shown.length === 0 && (
          <p className="mt-6 text-center text-[13px] font-medium text-muted">Nothing here yet.</p>
        )}
      </ul>
    </>
  );
}
