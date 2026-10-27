"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createBroadcastCampaign, type BroadcastCampaign } from "@/lib/admin-broadcasts";
import { recipientKindLabel } from "@/lib/partner-kind";
import { Panel, RowHead, Row, Cell, EmptyState, Pill, Disclosure } from "../../admin-ui";

const COLS = "md:grid-cols-[minmax(0,1.4fr)_140px_140px_minmax(0,auto)]";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export default function BroadcastsListView({ campaigns }: { campaigns: BroadcastCampaign[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  const create = async () => {
    if (creating) return;
    setCreating(true);
    const result = await createBroadcastCampaign(name);
    setCreating(false);
    if (result.ok && result.id) router.push(`/admin/communications/broadcasts/${result.id}`);
  };

  return (
    <>
      <Panel title="Create template" className="mb-5">
        <div className="flex flex-wrap items-end gap-3 px-5 py-4">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold text-muted uppercase">Name (just for you — not sent)</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Monsoon update, October"
              className="h-10 w-72 rounded-xl border border-line bg-surface px-3 text-[13px] font-medium outline-none focus:border-brand"
            />
          </label>
          <button
            type="button"
            disabled={creating}
            onClick={create}
            className="h-10 rounded-xl bg-brand px-5 text-[13px] font-bold text-white disabled:bg-line disabled:text-muted"
          >
            {creating ? "Creating…" : "Create template"}
          </button>
        </div>
      </Panel>

      <Panel>
        <RowHead cols={COLS}>
          <span>Name</span>
          <span>Status</span>
          <span>Sent to</span>
          <span />
        </RowHead>
        {campaigns.length === 0 ? (
          <EmptyState>No broadcasts yet — create one above.</EmptyState>
        ) : (
          campaigns.map((c) => (
            <Row key={c.id} cols={COLS} href={`/admin/communications/broadcasts/${c.id}`}>
              <Cell>
                <span className="block text-[13.5px] font-bold">{c.name}</span>
                <span className="block text-[11.5px] font-medium text-muted">
                  {c.status === "sent" ? `Sent ${formatTime(c.sentAt!)}` : `Edited ${formatTime(c.updatedAt)}`}
                </span>
              </Cell>
              <Cell label="Status">
                {c.status === "sent" ? <Pill tone="done">Sent</Pill> : <Pill tone="waiting">Draft</Pill>}
              </Cell>
              <Cell label="Sent to">
                {c.status === "sent"
                  ? `${c.recipientsSent} · ${recipientKindLabel(c.recipientKind)}`
                  : recipientKindLabel(c.recipientKind)}
              </Cell>
              <Cell className="md:flex md:justify-end">
                <Disclosure />
              </Cell>
            </Row>
          ))
        )}
      </Panel>
    </>
  );
}
