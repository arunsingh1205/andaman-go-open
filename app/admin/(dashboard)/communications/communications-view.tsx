"use client";

// Transactional-only: a log of what's already gone out (welcome emails,
// booking notifications, settlement emails/WhatsApp) and a resend button on
// anything that failed. No campaign/broadcast composer here on purpose —
// that's explicitly out of scope for this screen.

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  resendNotification,
  type NotificationLogRow,
  type NotificationChannel,
  type NotificationStatus,
  type NotificationKind,
} from "@/lib/admin-communications";
import { ChipRow, Chip, Panel, RowHead, Row, Cell, EmptyState, Pill } from "../admin-ui";

const COLS = "md:grid-cols-[minmax(0,1.4fr)_110px_140px_110px_minmax(0,auto)]";

const KIND_LABEL: Record<NotificationKind, string> = {
  partner_welcome: "Welcome email",
  booking_new: "New booking",
  settlement_ready: "Settlement ready",
  settlement_paid: "Settlement paid",
  first_listing: "First listing email",
};

function statusPill(status: NotificationStatus) {
  if (status === "sent") return <Pill tone="live">Sent</Pill>;
  if (status === "failed") return <Pill tone="down">Failed</Pill>;
  return <Pill tone="waiting">Pending</Pill>;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

type Bucket = "all" | NotificationStatus;

export default function CommunicationsView({ notifications }: { notifications: NotificationLogRow[] }) {
  const router = useRouter();
  const [bucket, setBucket] = useState<Bucket>("all");
  const [channel, setChannel] = useState<NotificationChannel | "all">("all");
  const [resendingId, setResendingId] = useState<string | null>(null);

  const shown = notifications.filter(
    (n) => (bucket === "all" || n.status === bucket) && (channel === "all" || n.channel === channel),
  );

  const resend = async (id: string) => {
    setResendingId(id);
    await resendNotification(id);
    setResendingId(null);
    router.refresh();
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <ChipRow>
          <Chip label="All" count={notifications.length} active={bucket === "all"} onClick={() => setBucket("all")} />
          <Chip
            label="Failed"
            count={notifications.filter((n) => n.status === "failed").length}
            active={bucket === "failed"}
            onClick={() => setBucket("failed")}
          />
          <Chip
            label="Sent"
            count={notifications.filter((n) => n.status === "sent").length}
            active={bucket === "sent"}
            onClick={() => setBucket("sent")}
          />
          <Chip
            label="Pending"
            count={notifications.filter((n) => n.status === "pending").length}
            active={bucket === "pending"}
            onClick={() => setBucket("pending")}
          />
        </ChipRow>
        <ChipRow>
          <Chip label="Email" active={channel === "email"} onClick={() => setChannel(channel === "email" ? "all" : "email")} />
          <Chip
            label="WhatsApp"
            active={channel === "whatsapp"}
            onClick={() => setChannel(channel === "whatsapp" ? "all" : "whatsapp")}
          />
        </ChipRow>
      </div>

      <Panel>
        <RowHead cols={COLS}>
          <span>Recipient</span>
          <span>Channel</span>
          <span>Kind</span>
          <span>Status</span>
          <span />
        </RowHead>

        {shown.length === 0 ? (
          <EmptyState>Nothing here.</EmptyState>
        ) : (
          shown.map((n) => (
            <Row key={n.id} cols={COLS}>
              <Cell>
                <span className="block text-[13.5px] font-bold">{n.recipientAddress}</span>
                <span className="block text-[11.5px] font-medium text-muted">
                  {n.recipientType === "partner" ? "Partner" : "Customer"} · {formatTime(n.createdAt)}
                  {n.retryOf && " · resend"}
                </span>
              </Cell>
              <Cell label="Channel" className="capitalize">
                {n.channel}
              </Cell>
              <Cell label="Kind">{KIND_LABEL[n.kind]}</Cell>
              <Cell label="Status">
                {statusPill(n.status)}
                {n.status === "failed" && n.error && (
                  <span className="mt-1 block max-w-[220px] truncate text-[11px] font-medium text-warn" title={n.error}>
                    {n.error}
                  </span>
                )}
              </Cell>
              <Cell className="md:flex md:justify-end">
                {n.status === "failed" && n.kind === "first_listing" ? (
                  // This kind carries a PDF + a large commission-table email
                  // that only lib/email.ts knows how to build — the generic
                  // resend pipeline (Edge Function) deliberately can't send
                  // it, so send the admin to the page that actually can.
                  <Link
                    href="/admin/communications/broadcasts/first-listing"
                    className="h-9 rounded-xl border border-line bg-surface px-3.5 text-[12.5px] font-bold text-brand leading-9"
                  >
                    Use first-listing backfill
                  </Link>
                ) : (
                  n.status === "failed" && (
                    <button
                      type="button"
                      disabled={resendingId === n.id}
                      onClick={() => resend(n.id)}
                      className="h-9 rounded-xl border border-line bg-surface px-3.5 text-[12.5px] font-bold text-brand disabled:text-muted"
                    >
                      {resendingId === n.id ? "Queuing…" : "Resend"}
                    </button>
                  )
                )}
              </Cell>
            </Row>
          ))
        )}
      </Panel>
    </>
  );
}
