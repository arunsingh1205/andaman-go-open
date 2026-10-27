"use client";

// Revenue by partner, for one month — split into gross, commission (at each
// business's own agreed rate, set on their partner page) and net.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { RevenueMonth } from "@/lib/admin-revenue";
import { setCategoryPayment, type CategoryPayment } from "@/lib/admin-payment";
import type { PaymentMode } from "@/lib/payments";
import { KIND_LABEL, type BookingKind } from "@/lib/bookings";
import { islandLabel } from "@/lib/islands";
import {
  PageHeader,
  Panel,
  StatTile,
  RowHead,
  Row,
  Cell,
  EmptyState,
  rupees,
  partnerStatusPill,
} from "../admin-ui";

const COLS =
  "md:grid-cols-[minmax(0,1.6fr)_minmax(0,0.8fr)_80px_110px_110px_110px_minmax(0,0.9fr)]";

export default function RevenueView({
  data,
  months,
  payments,
}: {
  data: RevenueMonth;
  months: { key: string; label: string }[];
  payments: CategoryPayment[];
}) {
  const router = useRouter();

  return (
    <>
      <PageHeader
        title="Revenue"
        subtitle={`${data.label} · delivered work, plus what cancellations retained`}
      >
        <select
          value={data.monthKey}
          onChange={(e) => router.push(`/admin/revenue?month=${e.target.value}`)}
          className="h-9 rounded-xl border border-line bg-surface px-3 text-[12.5px] font-bold text-ink outline-none focus:border-brand"
        >
          {months.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>
      </PageHeader>

      <PaymentModePanel payments={payments} />

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Gross"
          value={rupees(data.totalGrossPaise)}
          hint="checked-in + retained on cancellations"
        />
        <StatTile
          label="Commission"
          value={rupees(data.totalCommissionPaise)}
          hint="Andaman Go's cut"
        />
        <StatTile
          label="We owe partners"
          value={rupees(data.totalPlatformOwesPaise)}
          hint={`${rupees(data.totalCashCollectedPaise)} taken at counters`}
          tone="brand"
        />
        <StatTile
          label="Delivered"
          value={data.totalDelivered}
          hint={
            data.totalCancelled > 0
              ? `+${data.totalCancelled} cancelled, kept money`
              : "bookings actually run"
          }
        />
      </div>

      <Panel className="mt-5" title={`By business · ${data.label}`}>
        <RowHead cols={COLS}>
          <span>Business</span>
          <span>Island</span>
          <span>Done</span>
          <span className="text-right">Gross</span>
          <span className="text-right">Commission</span>
          <span className="text-right">We owe</span>
          <span>Share</span>
        </RowHead>

        {data.rows.length === 0 ? (
          <EmptyState>
            Nothing was checked in or cancelled-with-money-retained during {data.label}. A booking
            counts here once a partner has actually checked the traveller in, or a cancellation kept
            some of what was paid — not when the booking was made.
          </EmptyState>
        ) : (
          data.rows.map((row) => (
            <Row key={row.partnerId} cols={COLS}>
              <Cell>
                <span className="flex items-center gap-2.5">
                  <Link
                    href={`/admin/partners/${row.partnerId}`}
                    className="min-w-0 truncate text-[13.5px] font-bold text-brand hover:underline"
                  >
                    {row.partnerName}
                  </Link>
                  {row.partnerStatus !== "approved" && partnerStatusPill(row.partnerStatus)}
                </span>
              </Cell>

              <Cell label="Island">
                <span className="text-[12.5px] font-medium text-muted">
                  {islandLabel(row.islandSlug)}
                </span>
              </Cell>

              <Cell label="Delivered">
                <span className="text-[13px] font-bold">{row.delivered}</span>
                {row.cancelled > 0 && (
                  <span className="mt-0.5 block text-[10.5px] font-semibold text-muted">
                    +{row.cancelled} cancelled
                  </span>
                )}
              </Cell>

              <Cell label="Gross" className="md:text-right">
                <span className="text-[13px] font-bold">{rupees(row.grossPaise)}</span>
              </Cell>

              <Cell label="Commission" className="md:text-right">
                <span className="text-[13px] font-semibold text-muted">
                  {rupees(row.commissionPaise)}
                </span>
              </Cell>

              <Cell label="We owe" className="md:text-right">
                <span className="text-[13px] font-bold text-brand">
                  {rupees(row.platformOwesPaise)}
                </span>
                {row.cashCollectedPaise > 0 && (
                  <span className="mt-0.5 block text-[10.5px] font-semibold text-muted">
                    +{rupees(row.cashCollectedPaise)} at counter
                  </span>
                )}
              </Cell>

              <Cell label="Share">
                <span className="flex items-center gap-2.5">
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-ground">
                    <span
                      className="block h-full rounded-full bg-brand"
                      style={{ width: `${Math.max(row.sharePct, 2)}%` }}
                    />
                  </span>
                  <span className="w-9 shrink-0 text-right text-[11.5px] font-bold text-muted">
                    {row.sharePct.toFixed(0)}%
                  </span>
                </span>
              </Cell>
            </Row>
          ))
        )}
      </Panel>

      <p className="mt-4 text-[12px] font-medium text-muted">
        Gross is what travellers were charged, counted once a partner checks them in — plus whatever a
        cancellation retained instead of refunding. On a delivered booking, commission is Andaman
        Go&apos;s cut at that business&apos;s own agreed rate (set on their partner page) — a deposit
        collects exactly that online, so of the rest, a partner keeps whatever they took in cash at their
        counter, whether that&apos;s the balance on a deposit or the part of a cab fare the driver
        collects directly. On a cancellation nothing was delivered, so the whole amount retained counts as
        commission and nothing reaches a counter or is owed. &ldquo;We owe&rdquo; is what Andaman Go
        would pay a partner once settlement runs. Nothing here has actually been paid.
      </p>
    </>
  );
}

const RATE_ORDER: BookingKind[] = [
  "activity",
  "trip",
  "rental",
  "cab",
  "stay",
  "event",
  "ferry",
];

const PAYMENT_MODES: { value: PaymentMode; label: string }[] = [
  { value: "free", label: "Free" },
  { value: "full", label: "Pay in full" },
  { value: "choice", label: "Commission or full" },
  { value: "contact", label: "Commission or full" },
];

function PaymentModePanel({ payments }: { payments: CategoryPayment[] }) {
  const router = useRouter();
  const byKind = new Map(payments.map((p) => [p.kind, p.mode]));
  const ordered = RATE_ORDER.filter((k) => byKind.has(k));
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const save = async (kind: BookingKind, mode: PaymentMode) => {
    setBusy(kind);
    setProblem(null);
    const result = await setCategoryPayment(kind, mode);
    setBusy(null);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    router.refresh();
  };

  return (
    <Panel className="mt-5" title="How each category is paid for">
      <div className="grid gap-x-6 gap-y-3 px-5 py-4 sm:grid-cols-2 lg:grid-cols-3">
        {ordered.map((kind) => (
          <div key={kind} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[13px] font-bold">{KIND_LABEL[kind]}</span>
            <select
              value={byKind.get(kind)}
              disabled={busy !== null}
              onChange={(e) => save(kind, e.target.value as PaymentMode)}
              className="h-9 rounded-lg border border-line bg-surface px-2 text-[12.5px] font-bold outline-none focus:border-brand disabled:opacity-60"
            >
              {PAYMENT_MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      {problem && <p className="px-5 pb-4 text-[11.5px] font-medium text-warn">{problem}</p>}
    </Panel>
  );
}
