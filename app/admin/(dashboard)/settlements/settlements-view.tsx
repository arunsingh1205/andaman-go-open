"use client";

// Weekly settlement, every category (101) — Andaman Go is holding a
// partner's share on anything paid online (in full, or a deposit) until
// this runs. "Run settlement" computes the ISO week (Mon–Sun) by default and
// lets an admin adjust the window before running; "Mark paid" records the
// bank/UPI reference once the transfer has actually happened outside the
// app — there is no automated payout here.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  runSettlement as runSettlementRpc,
  markSettlementPaid,
  getSettlementItems,
  type SettlementBatch,
  type SettlementItem,
} from "@/lib/admin-settlements";
import { ChipRow, Chip, Panel, RowHead, Row, Cell, EmptyState, Pill, rupees } from "../admin-ui";
import { ChevronIcon } from "@/app/icons";

type Bucket = "pending" | "paid" | "all";

const COLS = "md:grid-cols-[minmax(0,1.4fr)_120px_120px_120px_120px_minmax(0,auto)]";

function isoWeek(offsetWeeks = 0): { start: string; end: string } {
  const now = new Date();
  const day = now.getUTCDay(); // 0 = Sunday
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() + diffToMonday + offsetWeeks * 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const key = (d: Date) => d.toISOString().slice(0, 10);
  return { start: key(monday), end: key(sunday) };
}

export default function SettlementsView({ batches }: { batches: SettlementBatch[] }) {
  const router = useRouter();
  const [bucket, setBucket] = useState<Bucket>("pending");
  const thisWeek = useMemo(() => isoWeek(-1), []); // last full week, by default
  const [periodStart, setPeriodStart] = useState(thisWeek.start);
  const [periodEnd, setPeriodEnd] = useState(thisWeek.end);
  const [running, setRunning] = useState(false);
  const [runMessage, setRunMessage] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [items, setItems] = useState<Record<string, SettlementItem[]>>({});
  const [payingId, setPayingId] = useState<string | null>(null);
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [payBusy, setPayBusy] = useState(false);
  const [payProblem, setPayProblem] = useState<string | null>(null);

  const shown = batches.filter((b) => bucket === "all" || b.status === bucket);

  const runSettlement = async () => {
    setRunning(true);
    setRunMessage(null);
    const result = await runSettlementRpc(periodStart, periodEnd);
    setRunning(false);
    setRunMessage(result.message);
    if (result.ok) router.refresh();
  };

  const toggleExpand = async (batch: SettlementBatch) => {
    if (expanded === batch.id) {
      setExpanded(null);
      return;
    }
    setExpanded(batch.id);
    if (!items[batch.id]) {
      const rows = await getSettlementItems(batch.id);
      setItems((prev) => ({ ...prev, [batch.id]: rows }));
    }
  };

  const submitPaid = async (batchId: string) => {
    if (reference.trim() === "" || payBusy) return;
    setPayBusy(true);
    setPayProblem(null);
    const result = await markSettlementPaid(batchId, reference, note);
    setPayBusy(false);
    if (!result.ok) {
      setPayProblem(result.message);
      return;
    }
    setPayingId(null);
    setReference("");
    setNote("");
    router.refresh();
  };

  return (
    <>
      <Panel title="Run this week's settlement" className="mb-5">
        <div className="flex flex-wrap items-end gap-3 px-5 py-4">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-muted uppercase">Period start</span>
            <input
              type="date"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
              className="h-10 rounded-xl border border-line bg-surface px-3 text-[13px] font-semibold outline-none focus:border-brand"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-muted uppercase">Period end</span>
            <input
              type="date"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
              className="h-10 rounded-xl border border-line bg-surface px-3 text-[13px] font-semibold outline-none focus:border-brand"
            />
          </label>
          <button
            type="button"
            disabled={running}
            onClick={runSettlement}
            className="h-10 rounded-xl bg-brand px-5 text-[13px] font-bold text-white disabled:bg-line disabled:text-muted"
          >
            {running ? "Running…" : "Run settlement"}
          </button>
          {runMessage && <p className="text-[12.5px] font-medium text-muted">{runMessage}</p>}
        </div>
        <p className="border-t border-hairline px-5 py-3 text-[11.5px] font-medium text-muted">
          Covers every category — activities, ferries, cabs, events, trips, rentals and stays.
          Settles a booking once it&apos;s actually delivered (checked in), or once a cancellation
          still retained money, and falls inside this window. Nothing is ever settled twice.
        </p>
      </Panel>

      <ChipRow>
        <Chip label="Pending" count={batches.filter((b) => b.status === "pending").length} active={bucket === "pending"} onClick={() => setBucket("pending")} />
        <Chip label="Paid" count={batches.filter((b) => b.status === "paid").length} active={bucket === "paid"} onClick={() => setBucket("paid")} />
        <Chip label="All" count={batches.length} active={bucket === "all"} onClick={() => setBucket("all")} />
      </ChipRow>

      <Panel className="mt-4">
        <RowHead cols={COLS}>
          <span>Business · period</span>
          <span>Gross</span>
          <span>Commission</span>
          <span>Net payable</span>
          <span>Status</span>
          <span />
        </RowHead>

        {shown.length === 0 ? (
          <EmptyState>Nothing here.</EmptyState>
        ) : (
          shown.map((b) => (
            <div key={b.id}>
              <Row cols={COLS}>
                <Cell>
                  <button
                    type="button"
                    onClick={() => toggleExpand(b)}
                    className="flex items-center gap-1.5 text-left"
                  >
                    <ChevronIcon
                      size={14}
                      className={`shrink-0 text-muted transition-transform ${expanded === b.id ? "rotate-90" : ""}`}
                    />
                    <span>
                      <span className="block text-[13.5px] font-bold">{b.partnerName}</span>
                      <span className="block text-[11.5px] font-medium text-muted">
                        {b.periodStart} → {b.periodEnd} · {b.itemCount} booking{b.itemCount === 1 ? "" : "s"}
                      </span>
                    </span>
                  </button>
                </Cell>
                <Cell label="Gross">{rupees(b.grossPaise)}</Cell>
                <Cell label="Commission">{rupees(b.commissionPaise)}</Cell>
                <Cell label="Net payable" className="font-bold">
                  {rupees(b.netPayablePaise)}
                </Cell>
                <Cell label="Status">
                  {b.status === "paid" ? <Pill tone="live">Paid</Pill> : <Pill tone="waiting">Pending</Pill>}
                </Cell>
                <Cell className="md:flex md:justify-end">
                  {b.status === "pending" &&
                    (payingId === b.id ? null : (
                      <button
                        type="button"
                        onClick={() => {
                          setPayingId(b.id);
                          setPayProblem(null);
                        }}
                        className="h-9 rounded-xl border border-line bg-surface px-3.5 text-[12.5px] font-bold text-brand"
                      >
                        Mark paid
                      </button>
                    ))}
                  {b.status === "paid" && b.payoutReference && (
                    <span className="text-[11.5px] font-medium text-muted">Ref: {b.payoutReference}</span>
                  )}
                </Cell>
              </Row>

              {payingId === b.id && (
                <div className="border-b border-hairline bg-ground px-5 py-3.5">
                  <p className="text-[12px] font-medium text-muted">
                    Record the bank/UPI reference for the transfer you already made to {b.partnerName}.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <input
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                      placeholder="UTR / reference number"
                      className="h-10 min-w-[200px] flex-1 rounded-xl border border-line bg-surface px-3 text-[13px] font-semibold outline-none focus:border-brand"
                    />
                    <input
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Note (optional)"
                      className="h-10 min-w-[160px] flex-1 rounded-xl border border-line bg-surface px-3 text-[13px] font-medium outline-none focus:border-brand"
                    />
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      disabled={reference.trim() === "" || payBusy}
                      onClick={() => submitPaid(b.id)}
                      className="h-9 rounded-xl bg-brand px-4 text-[12.5px] font-bold text-white disabled:bg-line disabled:text-muted"
                    >
                      {payBusy ? "Saving…" : "Confirm paid"}
                    </button>
                    <button
                      type="button"
                      disabled={payBusy}
                      onClick={() => {
                        setPayingId(null);
                        setReference("");
                        setNote("");
                        setPayProblem(null);
                      }}
                      className="h-9 rounded-xl border border-line bg-surface px-4 text-[12.5px] font-bold text-ink"
                    >
                      Never mind
                    </button>
                  </div>
                  {payProblem && <p className="mt-1.5 text-[12px] font-bold text-warn">{payProblem}</p>}
                </div>
              )}

              {expanded === b.id && (
                <div className="border-b border-hairline px-5 py-3">
                  {!items[b.id] ? (
                    <p className="text-[12.5px] font-medium text-muted">Loading…</p>
                  ) : items[b.id].length === 0 ? (
                    <p className="text-[12.5px] font-medium text-muted">No bookings in this batch.</p>
                  ) : (
                    <ul className="flex flex-col gap-1.5">
                      {items[b.id].map((it) => (
                        <li key={it.id} className="flex items-center justify-between text-[12.5px] font-medium">
                          <span className="text-muted">
                            {it.ticketCode ?? "—"} · {it.kindLabel} · {it.title ?? "Booking"}
                            {it.event === "cancelled_retained" && (
                              <span className="ml-1.5 text-warn">(cancelled, retained)</span>
                            )}
                          </span>
                          <span>
                            {rupees(it.grossPaise)} − {rupees(it.commissionPaise)}
                            {it.cashCollectedPaise > 0 && ` − ${rupees(it.cashCollectedPaise)} cash`} ={" "}
                            {rupees(it.netPayablePaise)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </Panel>
    </>
  );
}
