"use client";

import type { SupportThreadRow } from "@/lib/admin-support";
import { PageHeader, Panel, RowHead, Row, Cell, EmptyState, Pill } from "../admin-ui";

const COLS = "md:grid-cols-[minmax(0,1.4fr)_110px_minmax(0,2fr)_140px]";

export default function SupportView({ threads }: { threads: SupportThreadRow[] }) {
  const open = threads.filter((t) => t.status === "open");
  const waiting = open.filter((t) => t.partnerUnread > 0).length;

  return (
    <>
      <PageHeader
        title="Support"
        subtitle={
          waiting > 0
            ? `${waiting} ${waiting === 1 ? "thread needs" : "threads need"} a reply`
            : "Every partner conversation"
        }
      />

      <Panel>
        <RowHead cols={COLS}>
          <span>Business</span>
          <span>Status</span>
          <span>Latest</span>
          <span>Updated</span>
        </RowHead>

        {threads.length === 0 ? (
          <EmptyState>No partner has opened a conversation yet.</EmptyState>
        ) : (
          threads.map((t) => (
            <Row key={t.partnerId} cols={COLS} href={`/admin/support/${t.partnerId}`}>
              <Cell>
                <span className="flex items-center gap-2">
                  <span className="min-w-0 truncate text-[13.5px] font-bold text-brand">
                    {t.partnerName}
                  </span>
                  {t.partnerUnread > 0 && (
                    <span className="shrink-0 rounded-full bg-sand px-1.5 text-[11px] font-bold text-white">
                      {t.partnerUnread}
                    </span>
                  )}
                </span>
              </Cell>

              <Cell label="Status">
                {t.status === "resolved" ? (
                  <Pill tone="muted">Resolved</Pill>
                ) : t.partnerUnread > 0 ? (
                  <Pill tone="waiting">Needs reply</Pill>
                ) : (
                  <Pill tone="live">Open</Pill>
                )}
              </Cell>

              <Cell label="Latest">
                <span className="line-clamp-1 text-[12.5px] font-medium text-muted">
                  {t.lastBody
                    ? `${t.lastFromPartner ? "" : "You: "}${t.lastBody}`
                    : "No messages"}
                </span>
              </Cell>

              <Cell label="Updated">
                <span className="text-[12px] font-medium text-muted">{t.updatedAtLabel}</span>
              </Cell>
            </Row>
          ))
        )}
      </Panel>
    </>
  );
}
