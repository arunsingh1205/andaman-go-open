"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  markSupportRead,
  sendSupportMessage,
  type SupportThread,
} from "@/lib/partner-support";
import { ChevronIcon } from "@/app/icons";

const FAQ: { q: string; a: string }[] = [
  {
    q: "When does a booking need my confirmation?",
    a: "Activities, day trips and rentals arrive as “pending” — the traveller has picked you, but you say yes before it's real. Ferries, tables, event tickets and rooms are confirmed the moment they're booked. Confirm or decline a pending one from the Bookings tab or its detail page.",
  },
  {
    q: "How do payouts work?",
    a: "Earnings shows what you're owed (gross, minus Andaman Go's commission, equals net) for every booking you've checked in, plus whatever a cancellation retained instead of refunding — grouped into monthly statements. There's no automatic payout yet; add your bank or UPI details on the Earnings tab so they're on file for when payouts start.",
  },
  {
    q: "Why is my new listing not showing to travellers?",
    a: "Every listing is reviewed by Andaman Go before it goes live, and so is your business itself. Both have to be approved. The Business tab shows the status of each — “In review”, “Live”, or “Not approved” with a reason you can fix and resubmit.",
  },
  {
    q: "How do I close a date for weather?",
    a: "On the Calendar tab, pick the day and use “Close the whole day — weather”, or close one activity or trip at a time. Travellers see it as closed and can't book it. Reopen it the same way. Only the business owner can close dates.",
  },
  {
    q: "Can I add staff?",
    a: "Yes — Settings → Team → invite by email. They sign in with that Google account and accept. Staff can work bookings and check people in, but can't see earnings, edit listings, or manage the team.",
  },
  {
    q: "A traveller didn't turn up. What do I do?",
    a: "On the Check in tab, once their time has passed, mark them a no-show. If fewer people came than booked, tap the party count first and set what actually arrived, then check them in.",
  },
];

export default function HelpView({ thread }: { thread: SupportThread }) {
  return (
    <div className="mt-6 flex flex-col gap-8 desk:max-w-2xl">
      <section>
        <h3 className="text-[13.5px] font-bold">Common questions</h3>
        <ul className="mt-2 flex flex-col gap-1.5">
          {FAQ.map((item) => (
            <FaqRow key={item.q} q={item.q} a={item.a} />
          ))}
        </ul>
      </section>

      <SupportThreadPanel thread={thread} />
    </div>
  );
}

function FaqRow({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-[16px] border border-line bg-surface desk:rounded-xl">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left"
      >
        <span className="text-[13px] font-bold">{q}</span>
        <ChevronIcon
          size={14}
          className={`shrink-0 text-muted transition-transform ${open ? "rotate-90" : ""}`}
        />
      </button>
      {open && (
        <p className="border-t border-hairline px-3.5 py-3 text-[12.5px] leading-relaxed font-medium text-muted">
          {a}
        </p>
      )}
    </li>
  );
}

function SupportThreadPanel({ thread }: { thread: SupportThread }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void markSupportRead().then(() => router.refresh());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [thread.messages.length]);

  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setProblem(null);
    const result = await sendSupportMessage(body);
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    setText("");
    router.refresh();
  };

  return (
    <section>
      <div className="flex items-center justify-between">
        <h3 className="text-[13.5px] font-bold">Message Andaman Go</h3>
        {thread.status === "resolved" && (
          <span className="rounded-full bg-line px-2 py-1 text-[10px] font-bold text-muted">
            Resolved
          </span>
        )}
      </div>

      {thread.messages.length === 0 ? (
        <p className="mt-2 text-[12.5px] font-medium text-muted">
          Ask us anything about a booking, a payout, a listing — this reaches the team directly.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {thread.messages.map((m) => (
            <li
              key={m.id}
              className={`max-w-[85%] rounded-[18px] px-3.5 py-2.5 desk:rounded-2xl ${
                m.fromPartner
                  ? "self-end bg-brand text-white"
                  : "self-start border border-line bg-surface text-ink"
              }`}
            >
              <p className="text-[13px] leading-snug font-medium whitespace-pre-wrap">{m.body}</p>
              <p
                className={`mt-1 text-[10px] font-semibold ${
                  m.fromPartner ? "text-white/70" : "text-muted"
                }`}
              >
                {m.fromPartner ? "You" : "Andaman Go"} · {m.stampLabel}
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
          placeholder="Type your message…"
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
    </section>
  );
}
