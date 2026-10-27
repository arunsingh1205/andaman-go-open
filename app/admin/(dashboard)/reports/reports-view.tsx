"use client";

import { useState } from "react";
import { KIND_LABEL } from "@/lib/bookings";
import { resolveMessageReport, type MessageReport } from "@/lib/admin-reports";
import { PageHeader, Panel, RowHead, Row, Cell, EmptyState, Pill } from "../admin-ui";
import { CheckIcon } from "@/app/icons";

const COLS = "md:grid-cols-[110px_minmax(0,1.2fr)_minmax(0,2fr)_100px_140px_110px]";

export default function ReportsView({ reports: initial }: { reports: MessageReport[] }) {
  const [reports, setReports] = useState(initial);
  const [busyId, setBusyId] = useState<string | null>(null);

  const open = reports.filter((r) => r.status === "open");

  const resolve = async (id: string) => {
    if (busyId) return;
    setBusyId(id);
    const result = await resolveMessageReport(id);
    if (result.ok) {
      setReports((prev) => prev.map((r) => (r.id === id ? { ...r, status: "resolved" } : r)));
    }
    setBusyId(null);
  };

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle={
          open.length > 0
            ? `${open.length} ${open.length === 1 ? "report needs" : "reports need"} a look`
            : "Nothing open"
        }
      />

      <Panel>
        <RowHead cols={COLS}>
          <span>Booking</span>
          <span>Business</span>
          <span>Reason</span>
          <span>Filed by</span>
          <span>When</span>
          <span>Status</span>
        </RowHead>

        {reports.length === 0 ? (
          <EmptyState>No reports have been filed.</EmptyState>
        ) : (
          reports.map((r) => (
            <Row key={r.id} cols={COLS}>
              <Cell>
                <span className="text-[13.5px] font-bold text-brand">{r.refCode}</span>
                <span className="ml-1.5 text-[11.5px] font-medium text-muted">
                  {KIND_LABEL[r.kind]}
                </span>
              </Cell>

              <Cell label="Business">
                <span className="text-[12.5px] font-semibold text-ink">{r.partnerName}</span>
              </Cell>

              <Cell label="Reason">
                <span className="line-clamp-2 text-[12.5px] font-medium text-muted">
                  {r.reason}
                </span>
              </Cell>

              <Cell label="Filed by">
                <span className="text-[12.5px] font-semibold text-ink capitalize">
                  {r.reportedBy}
                </span>
              </Cell>

              <Cell label="When">
                <span className="text-[12px] font-medium text-muted">{r.createdAtLabel}</span>
              </Cell>

              <Cell label="Status">
                {r.status === "resolved" ? (
                  <Pill tone="muted">Resolved</Pill>
                ) : (
                  <button
                    type="button"
                    disabled={busyId === r.id}
                    onClick={() => resolve(r.id)}
                    className="flex h-9 items-center gap-1.5 rounded-xl border border-line px-3 text-[12px] font-bold text-brand disabled:opacity-50"
                  >
                    <CheckIcon size={14} />
                    {busyId === r.id ? "…" : "Resolve"}
                  </button>
                )}
              </Cell>
            </Row>
          ))
        )}
      </Panel>
    </>
  );
}
