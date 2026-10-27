"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  adminMarkSupportRead,
  adminReplySupport,
  setSupportStatus,
  type AdminSupportThread,
} from "@/lib/admin-support";
import { PageHeader } from "../../admin-ui";
import { BackIcon } from "@/app/icons";

export default function ThreadView({ thread }: { thread: AdminSupportThread }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void adminMarkSupportRead(thread.partnerId).then(() => router.refresh());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.partnerId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [thread.messages.length]);

  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setProblem(null);
    const result = await adminReplySupport(thread.partnerId, body);
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    setText("");
    router.refresh();
  };

  const toggleStatus = async () => {
    if (busy) return;
    setBusy(true);
    await setSupportStatus(thread.partnerId, thread.status === "open" ? "resolved" : "open");
    setBusy(false);
    router.refresh();
  };

  return (
    <>
      <Link
        href="/admin/support"
        className="mb-3 flex items-center gap-1.5 text-[13px] font-bold text-muted"
      >
        <BackIcon size={14} />
        Support
      </Link>

      <PageHeader title={thread.partnerName} subtitle="Conversation with Andaman Go">
        <button
          type="button"
          disabled={busy}
          onClick={toggleStatus}
          className="h-9 rounded-xl border border-line bg-surface px-3.5 text-[12.5px] font-bold text-ink hover:bg-ground disabled:opacity-50"
        >
          {thread.status === "open" ? "Mark resolved" : "Reopen"}
        </button>
      </PageHeader>

      <div className="rounded-2xl border border-line bg-surface p-4 md:max-w-2xl">
        {thread.messages.length === 0 ? (
          <p className="text-[12.5px] font-medium text-muted">No messages yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {thread.messages.map((m) => (
              <li
                key={m.id}
                className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 ${
                  m.fromPartner
                    ? "self-start border border-line bg-ground text-ink"
                    : "self-end bg-brand text-white"
                }`}
              >
                <p className="text-[13px] leading-snug font-medium whitespace-pre-wrap">{m.body}</p>
                <p
                  className={`mt-1 text-[10px] font-semibold ${
                    m.fromPartner ? "text-muted" : "text-white/70"
                  }`}
                >
                  {m.fromPartner ? thread.partnerName : "Andaman Go"} · {m.stampLabel}
                </p>
              </li>
            ))}
          </ul>
        )}
        <div ref={endRef} />

        <div className="mt-3 flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send())}
            placeholder="Reply to the partner…"
            className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3.5 text-[13.5px] font-medium outline-none focus:border-brand"
          />
          <button
            type="button"
            disabled={busy || text.trim() === ""}
            onClick={send}
            className="h-11 shrink-0 rounded-xl bg-brand px-4 text-[13px] font-bold text-white disabled:bg-line disabled:text-muted"
          >
            {busy ? "…" : "Send"}
          </button>
        </div>
        {problem && <p className="mt-2 text-[11.5px] font-medium text-warn">{problem}</p>}
      </div>
    </>
  );
}
