"use client";

// Earnings: "Andaman Go owes you" first — the balance left after the partner
// took the counter cash on deposit bookings — with gross, commission and net
// alongside. Plus monthly statements, a CSV export, and the payout account
// form. See lib/partner-earnings.ts — every figure is a real sum over either
// a checked-in booking, or a cancellation that still retained some money
// (a forfeited deposit, or the half kept on a full-payment cancellation).
// There is deliberately no "paid" status.

import { useState } from "react";
import { rupees } from "@/lib/activities";
import { KIND_LABEL, type BookingKind } from "@/lib/bookings";
import type { PartnerEarnings, EarningsWindow } from "@/lib/partner-earnings";
import { savePayoutAccount, type PayoutAccount } from "@/lib/partner-payouts";
import { useRouter } from "next/navigation";
import { StatTile } from "../stat-tile";
import {
  CalendarIcon,
  CarIcon,
  CheckIcon,
  ClockIcon,
  CloseIcon,
  DownloadIcon,
  DiveIcon,
  EarningsIcon,
  FerryIcon,
  GraphIcon,
  MusicIcon,
  BedIcon,
  PinIcon,
  ScooterIcon,
} from "@/app/icons";

const KIND_ICON: Record<BookingKind, typeof DiveIcon> = {
  activity: DiveIcon,
  ferry: FerryIcon,
  stay: BedIcon,
  event: MusicIcon,
  cab: CarIcon,
  trip: PinIcon,
  rental: ScooterIcon,
};

type SettledRow = {
  key: string;
  status: "delivered" | "cancelled";
  kind: BookingKind;
  title: string;
  refCode: string;
  detail: string;
  payMode: "full" | "deposit" | "partial";
  pricePaise: number;
  commissionPaise: number;
  netPaise: number;
  cashCollectedPaise: number;
  platformOwesPaise: number;
  whenLabel: string;
  sortIso: string;
};

export default function EarningsView({
  earnings,
  payoutAccount,
}: {
  earnings: PartnerEarnings;
  payoutAccount: PayoutAccount | null;
}) {
  const { stats, statements, delivered, cancelled } = earnings;

  const settled: SettledRow[] = [
    ...delivered.map((d): SettledRow => ({
      key: d.key,
      status: "delivered",
      kind: d.kind,
      title: d.title,
      refCode: d.refCode,
      detail: d.detail,
      payMode: d.payMode,
      pricePaise: d.pricePaise,
      commissionPaise: d.commissionPaise,
      netPaise: d.netPaise,
      cashCollectedPaise: d.cashCollectedPaise,
      platformOwesPaise: d.platformOwesPaise,
      whenLabel: `Checked in ${d.redeemedDateLabel} · ${d.redeemedTimeLabel}`,
      sortIso: d.redeemedAtIso,
    })),
    ...cancelled.map((c): SettledRow => ({
      key: c.key,
      status: "cancelled",
      kind: c.kind,
      title: c.title,
      refCode: c.refCode,
      detail: c.detail,
      payMode: c.payMode,
      pricePaise: c.retainedPaise,
      commissionPaise: c.commissionPaise,
      netPaise: c.netPaise,
      cashCollectedPaise: 0,
      platformOwesPaise: c.netPaise,
      whenLabel: `Cancelled ${c.cancelledDateLabel} · ${c.cancelledTimeLabel}`,
      sortIso: c.cancelledAtIso,
    })),
  ].sort((a, b) => b.sortIso.localeCompare(a.sortIso));

  const downloadCsv = () => {
    const header = [
      "Status",
      "When",
      "Listing",
      "Category",
      "Reference",
      "Party",
      "Paid",
      "Gross",
      "Commission",
      "Net",
      "Cash at counter",
      "Andaman Go owes",
    ];
    const rows = settled.map((r) => [
      r.status === "delivered" ? "Delivered" : "Cancelled, kept",
      r.whenLabel,
      r.title,
      KIND_LABEL[r.kind],
      r.refCode,
      r.detail,
      r.payMode === "deposit" || r.payMode === "partial" ? "Commission online" : "In full",
      (r.pricePaise / 100).toFixed(2),
      (r.commissionPaise / 100).toFixed(2),
      (r.netPaise / 100).toFixed(2),
      (r.cashCollectedPaise / 100).toFixed(2),
      (r.platformOwesPaise / 100).toFixed(2),
    ]);
    const csv = [header, ...rows]
      .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "andaman-go-earnings.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="mt-4 grid grid-cols-2 gap-2.5 tablet:grid-cols-4 desk:grid-cols-4 desk:gap-4">
        <WindowTile label="Today" w={stats.today} accent="teal" Icon={ClockIcon} />
        <WindowTile label="This week" w={stats.thisWeek} accent="orange" Icon={CalendarIcon} />
        <WindowTile label="This month" w={stats.thisMonth} accent="purple" Icon={GraphIcon} />
        <WindowTile label="All time" w={stats.allTime} accent="coral" Icon={EarningsIcon} />
      </div>

      <PayoutCard initial={payoutAccount} />

      <div className="mt-7 flex items-center justify-between">
        <h3 className="text-[14.5px] font-bold">Monthly statements</h3>
        {settled.length > 0 && (
          <button
            type="button"
            onClick={downloadCsv}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[12px] font-bold text-brand"
          >
            <DownloadIcon size={14} />
            CSV
          </button>
        )}
      </div>

      {statements.length === 0 ? (
        <p className="mt-3 text-[13px] font-medium text-muted">
          Nothing checked in yet. Once you check a traveller in, their booking shows up here.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {statements.map((s) => (
            <li key={s.monthKey} className="rounded-[16px] border border-line bg-surface p-3.5 desk:rounded-xl">
              <div className="flex items-baseline justify-between">
                <p className="text-[13.5px] font-bold">{s.label}</p>
                <p className="text-[13.5px] font-bold text-brand">{rupees(s.netPaise)}</p>
              </div>
              <p className="mt-1 text-[11.5px] font-medium text-muted">
                {s.count} {s.count === 1 ? "booking" : "bookings"} · {rupees(s.grossPaise)} gross
                {s.commissionPaise > 0 && <> · −{rupees(s.commissionPaise)} commission</>}
                {s.cancelledCount > 0 && (
                  <> · {s.cancelledCount} cancelled, {rupees(s.cancelledNetPaise)} kept</>
                )}
              </p>
              {(s.cashCollectedPaise > 0 || s.platformOwesPaise !== s.netPaise) && (
                <p className="mt-0.5 text-[11px] font-semibold text-muted">
                  {rupees(s.cashCollectedPaise)} taken at the counter · {rupees(s.platformOwesPaise)}{" "}
                  from Andaman Go
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {settled.length > 0 && (
        <>
          <h3 className="mt-7 text-[14.5px] font-bold">Every settled booking</h3>
          <ul className="mt-3 grid gap-2.5 tablet:grid-cols-2 desk:grid-cols-2">
            {settled.map((item) => {
              const Icon = KIND_ICON[item.kind];
              return (
                <li key={item.key} className="rounded-[18px] border border-line bg-surface p-4 shadow-sm">
                  <div className="flex items-start gap-3">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px] bg-line text-muted">
                      <Icon size={21} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-bold tracking-wider text-muted uppercase">
                        {KIND_LABEL[item.kind]}
                      </p>
                      <p className="mt-0.5 text-[15px] leading-tight font-bold">{item.title}</p>
                      <p className="mt-1.5 text-[12.5px] font-medium text-muted">{item.whenLabel}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[14px] font-bold text-brand">
                        {rupees(item.platformOwesPaise)}
                      </p>
                      <p className="mt-0.5 text-[10.5px] font-semibold text-muted">from Andaman Go</p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-hairline pt-3">
                    {item.status === "delivered" ? (
                      <span className="flex items-center gap-1.5 rounded-full bg-brandsoft px-2.5 py-1.5 text-[11.5px] font-semibold text-brand">
                        <CheckIcon size={13} />
                        Delivered
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 rounded-full bg-line px-2.5 py-1.5 text-[11.5px] font-semibold text-muted">
                        <CloseIcon size={13} />
                        Cancelled, kept
                      </span>
                    )}
                    <span className="rounded-full border border-line bg-ground px-2.5 py-1 text-[11px] font-bold tracking-wide text-muted">
                      {item.refCode}
                    </span>
                    <span className="text-[10.5px] font-semibold text-muted">
                      {rupees(item.pricePaise)} {item.status === "delivered" ? "gross" : "retained"} −{" "}
                      {rupees(item.commissionPaise)} fee
                      {item.cashCollectedPaise > 0 && (
                        <> · {rupees(item.cashCollectedPaise)} counter cash</>
                      )}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}

function WindowTile({
  label,
  w,
  accent,
  Icon,
}: {
  label: string;
  w: EarningsWindow;
  accent: "teal" | "orange" | "purple" | "coral";
  Icon: typeof CheckIcon;
}) {
  const sub = `${w.count} ${w.count === 1 ? "booking" : "bookings"} · ${rupees(w.netPaise)} earned${
    w.cashCollectedPaise > 0 ? `, ${rupees(w.cashCollectedPaise)} at the counter` : ""
  }`;
  return (
    <StatTile
      label={`${label} · Andaman Go owes you`}
      value={w.platformOwesPaise > 0 ? rupees(w.platformOwesPaise) : "₹0"}
      sub={sub}
      tone="brand"
      accent={accent}
      Icon={Icon}
      desktopValuePx={20}
    />
  );
}

function last4(s: string | null): string | null {
  if (!s) return null;
  return s.length <= 4 ? s : `•••• ${s.slice(-4)}`;
}

function PayoutCard({ initial }: { initial: PayoutAccount | null }) {
  const router = useRouter();
  const has = initial !== null && (initial.accountNumber !== null || initial.upiId !== null);
  const [editing, setEditing] = useState(false);
  const [accountName, setAccountName] = useState(initial?.accountName ?? "");
  const [accountNumber, setAccountNumber] = useState(initial?.accountNumber ?? "");
  const [ifsc, setIfsc] = useState(initial?.ifsc ?? "");
  const [upiId, setUpiId] = useState(initial?.upiId ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const result = await savePayoutAccount({ accountName, accountNumber, ifsc, upiId });
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    setEditing(false);
    router.refresh();
  };

  if (!editing) {
    return (
      <div className="mt-5 rounded-[22px] border border-line bg-surface p-4 shadow-sm desk:rounded-2xl">
        <p className="text-[11px] font-bold tracking-wider text-muted uppercase">Payout account</p>
        {has ? (
          <>
            <p className="mt-1 text-[13.5px] font-bold">
              {initial?.upiId ?? last4(initial?.accountNumber ?? null)}
            </p>
            {initial?.accountName && (
              <p className="text-[11.5px] font-medium text-muted">{initial.accountName}</p>
            )}
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="mt-2 text-[12px] font-bold text-brand"
            >
              Edit
            </button>
          </>
        ) : (
          <>
            <p className="mt-1 text-[12px] font-medium text-muted">
              On file for when payouts go live. Nothing pays out yet.
            </p>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="mt-2 h-9 rounded-lg bg-brand px-4 text-[12.5px] font-bold text-white"
            >
              Add bank details
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="mt-5 rounded-[22px] border border-line bg-surface p-4 shadow-sm desk:rounded-2xl">
      <p className="text-[11px] font-bold tracking-wider text-muted uppercase">Payout account</p>
      <div className="mt-2 flex flex-col gap-2.5">
        <Field label="Account holder name" value={accountName} onChange={setAccountName} placeholder="As on the bank account" />
        <Field label="Account number" value={accountNumber} onChange={setAccountNumber} placeholder="Bank account number" inputMode="numeric" />
        <Field label="IFSC" value={ifsc} onChange={setIfsc} placeholder="SBIN0001234" />
        <Field label="UPI ID (optional)" value={upiId} onChange={setUpiId} placeholder="you@bank" />
      </div>
      {problem && <p className="mt-2 text-[11.5px] font-medium text-warn">{problem}</p>}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={save}
          className="h-10 rounded-lg bg-brand px-4 text-[12.5px] font-bold text-white disabled:bg-line disabled:text-muted"
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setEditing(false)}
          className="h-10 rounded-lg border border-line bg-surface px-4 text-[12.5px] font-bold text-ink disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  inputMode?: "numeric" | "text";
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11.5px] font-bold text-muted">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        className="h-10 rounded-lg border border-line bg-surface px-3 text-[13.5px] font-semibold outline-none focus:border-brand"
      />
    </label>
  );
}
