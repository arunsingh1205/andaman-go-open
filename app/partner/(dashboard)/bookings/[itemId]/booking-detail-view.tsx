"use client";

// One booking, in full — timeline, guest contact, the other things on the
// same reference, and the message thread. The check-in / cancel actions are
// the same RPC bridges the Bookings list calls, so acting here and acting
// there leave the database in the identical state.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { rupees } from "@/lib/activities";
import { KIND_LABEL, type BookingKind } from "@/lib/bookings";
import { cancelPartnerBooking } from "@/lib/partner-actions";
import { redeemBooking } from "@/lib/partner-redeem";
import {
  sendPartnerMessage,
  markPartnerThreadRead,
  blockPartnerThread,
  unblockPartnerThread,
  reportPartnerThread,
} from "@/lib/partner-messages";
import { istStampLabel } from "@/lib/partner-format";
import type { PartnerBookingDetail } from "@/lib/partner-booking-detail";
import type { PartnerBooking } from "@/lib/partner-bookings";
import DirectionsButton from "@/app/directions-button";
import {
  BackIcon,
  BlockIcon,
  CarIcon,
  CheckIcon,
  ChatIcon,
  ClockIcon,
  CloseIcon,
  DiveIcon,
  FerryIcon,
  FlagIcon,
  MoreIcon,
  MusicIcon,
  PinIcon,
  QrIcon,
  BedIcon,
  ScooterIcon,
  StormIcon,
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

export default function BookingDetailView({ detail }: { detail: PartnerBookingDetail }) {
  const {
    item,
    siblings,
    thread,
    threadBlockedBy,
    eventGuests,
    tripTravellers,
    pickupAddress,
    activityGuests,
    cabPickup,
  } = detail;
  const Icon = KIND_ICON[item.kind];

  return (
    <>
      <Link
        href="/partner/bookings"
        className="flex items-center gap-1.5 text-[13px] font-bold text-muted"
      >
        <BackIcon size={14} />
        Bookings
      </Link>

      <div className="mt-3 flex items-start gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-brandsoft text-brand">
          <Icon size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold tracking-wider text-muted uppercase">
            {KIND_LABEL[item.kind]}
          </p>
          <h2 className="font-display text-[19px] leading-tight font-bold tracking-tight">
            {item.title}
          </h2>
          <p className="mt-1 text-[12.5px] font-semibold text-ink">
            {item.dateLabel} · {item.timeLabel}
            <span className="font-medium text-muted"> · {item.detail}</span>
          </p>
        </div>
        <span className="shrink-0 text-right text-[15px] font-bold text-brand">
          {item.pricePaise === 0 ? "Free" : rupees(item.pricePaise)}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <StateChip item={item} />
        <span className="rounded-full border border-line bg-ground px-2.5 py-1 text-[11px] font-bold tracking-wide text-muted">
          {item.refCode}
        </span>
        {item.ticket && (
          <span className="rounded-full border border-line bg-ground px-2.5 py-1 text-[11px] font-bold tracking-wide text-muted">
            {item.ticket}
          </span>
        )}
      </div>

      {item.cancelledNote && (
        <div className="mt-3 rounded-xl border border-sandline bg-sandsoft px-3 py-2.5">
          <p className="text-[11px] font-bold tracking-wider text-sandink uppercase">
            Why it was cancelled
          </p>
          <p className="mt-1 text-[12.5px] leading-relaxed font-medium text-sandink2">
            {item.cancelledNote}
          </p>
        </div>
      )}

      <Actions item={item} />

      <div className="mt-7 grid gap-6 tablet:grid-cols-2 desk:grid-cols-2 desk:gap-8">
        <section>
          <SectionTitle>Timeline</SectionTitle>
          <ul className="mt-2 flex flex-col gap-2">
            <TimelineRow label="Booked" stamp={istStampLabel(item.bookedAtIso)} done />
            <TimelineRow
              label="Confirmed"
              stamp={item.confirmedAtIso ? istStampLabel(item.confirmedAtIso) : "on the spot"}
              done
            />
            <TimelineRow
              label="Checked in"
              stamp={item.redeemedAt ? istStampLabel(item.redeemedAt) : null}
              done={item.redeemedAt !== null}
            />
          </ul>
        </section>

        <section>
          <SectionTitle>Guest</SectionTitle>
          {item.contactPhone || item.contactEmail ? (
            <div className="mt-2 flex flex-col gap-2">
              {item.contactName && (
                <p className="text-[13px] font-bold text-ink">{item.contactName}</p>
              )}
              {item.contactPhone && (
                <a
                  href={`tel:${item.contactPhone}`}
                  className="flex items-center gap-2 rounded-xl border border-line bg-surface p-3 text-[13px] font-bold text-ink"
                >
                  <ChatIcon size={15} className="text-brand" />
                  {item.contactPhone}
                </a>
              )}
              {item.contactEmail && (
                <a
                  href={`mailto:${item.contactEmail}`}
                  className="flex items-center gap-2 rounded-xl border border-line bg-surface p-3 text-[13px] font-bold break-all text-ink"
                >
                  <ChatIcon size={15} className="text-brand" />
                  {item.contactEmail}
                </a>
              )}
            </div>
          ) : (
            <p className="mt-2 text-[12.5px] font-medium text-muted">
              No contact details on this booking. Use the messages below.
            </p>
          )}
        </section>
      </div>

      {eventGuests && eventGuests.length > 0 && (
        <section className="mt-7">
          <SectionTitle>Guest list</SectionTitle>
          <ul className="mt-2 flex flex-col gap-2">
            {eventGuests.map((g, i) => (
              <li
                key={i}
                className="flex items-center justify-between rounded-xl border border-line bg-surface p-3"
              >
                <span className="text-[13px] font-bold text-ink">
                  {g.fullName} <span className="font-medium text-muted">· {g.age}</span>
                </span>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${
                    g.ticketed ? "bg-brandsoft text-brand" : "bg-line text-muted"
                  }`}
                >
                  {g.ticketed ? "Ticketed" : "Free · 3 & under"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {activityGuests && activityGuests.length > 0 && (
        <section className="mt-7">
          <SectionTitle>Guest list</SectionTitle>
          <ul className="mt-2 flex flex-col gap-2">
            {activityGuests.map((g, i) => (
              <li
                key={i}
                className="rounded-xl border border-line bg-surface p-3 text-[13px] font-bold text-ink"
              >
                {g.fullName} <span className="font-medium text-muted">· {g.age}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {pickupAddress && (
        <section className="mt-7">
          <SectionTitle>{item.kind === "rental" ? "Deliver to" : "Pickup address"}</SectionTitle>
          <p className="mt-2 rounded-xl border border-line bg-surface p-3 text-[13px] leading-relaxed font-semibold whitespace-pre-line text-ink">
            {pickupAddress}
          </p>
        </section>
      )}

      {cabPickup && (
        <section className="mt-7">
          <SectionTitle>Pickup</SectionTitle>
          <div className="mt-2 flex flex-col gap-2 rounded-xl border border-line bg-surface p-3">
            <p className="text-[13px] leading-relaxed font-semibold text-ink">{cabPickup.routeLabel}</p>
            {cabPickup.pickupNote && (
              <p className="text-[12.5px] leading-relaxed font-medium text-muted">{cabPickup.pickupNote}</p>
            )}
            <DirectionsButton
              directions={cabPickup.directions}
              className="inline-flex h-10 w-fit items-center gap-1.5 rounded-full border border-line bg-ground px-3.5 text-[12px] font-bold text-brand"
            />
          </div>
        </section>
      )}

      {tripTravellers && tripTravellers.length > 0 && (
        <section className="mt-7">
          <SectionTitle>Traveller list</SectionTitle>
          <ul className="mt-2 flex flex-col gap-2">
            {tripTravellers.map((t, i) => (
              <li
                key={i}
                className="rounded-xl border border-line bg-surface p-3 text-[13px] font-bold text-ink"
              >
                {t.fullName} <span className="font-medium text-muted">· {t.age}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {siblings.length > 0 && (
        <section className="mt-7">
          <SectionTitle>Also with you on {item.dateLabel.toLowerCase()}</SectionTitle>
          <ul className="mt-2 flex flex-col gap-2">
            {siblings.map((s) => {
              const Sib = KIND_ICON[s.kind];
              return (
                <li key={s.itemId}>
                  <Link
                    href={`/partner/bookings/${s.itemId}`}
                    className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brandsoft text-brand">
                      <Sib size={15} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-bold">{s.title}</p>
                      <p className="text-[11px] font-medium text-muted">
                        {s.timeLabel} · {s.detail}
                      </p>
                    </div>
                    <span className="shrink-0 text-[12px] font-bold text-muted capitalize">
                      {s.state}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="mt-7">
        <SectionTitle>Messages</SectionTitle>
        <Thread itemId={item.itemId} thread={thread} blockedBy={threadBlockedBy} />
      </section>
    </>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[13.5px] font-bold">{children}</h3>;
}

function TimelineRow({
  label,
  stamp,
  done,
}: {
  label: string;
  stamp: string | null;
  done: boolean;
}) {
  return (
    <li className="flex items-center gap-2.5">
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
          done ? "bg-brand text-white" : "border border-line bg-surface text-muted"
        }`}
      >
        {done ? <CheckIcon size={11} /> : <ClockIcon size={11} />}
      </span>
      <span className="text-[12.5px] font-bold">{label}</span>
      <span className="ml-auto text-[11.5px] font-semibold text-muted">
        {stamp ?? "—"}
      </span>
    </li>
  );
}

function StateChip({ item }: { item: PartnerBooking }) {
  const base = "flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11.5px] font-semibold";

  if (item.redeemedAt) {
    return (
      <span className={`${base} bg-line text-muted`}>
        <CheckIcon size={13} />
        Checked in
      </span>
    );
  }
  if (item.state === "refunded" || item.state === "disrupted") {
    return (
      <span className={`${base} bg-sandsoft text-warn`}>
        <StormIcon size={13} />
        Cancelled
      </span>
    );
  }
  if (item.state === "missed" || item.state === "completed") {
    return (
      <span className={`${base} bg-line text-muted`}>
        <CheckIcon size={13} />
        {item.state === "missed" ? "No-show" : "Completed"}
      </span>
    );
  }
  return (
    <span className={`${base} bg-brandsoft text-brand`}>
      <CheckIcon size={13} />
      Confirmed
    </span>
  );
}

function Actions({ item }: { item: PartnerBooking }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"cancel" | "checkin" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [reason, setReason] = useState("");

  const act = async (fn: () => Promise<{ ok: boolean; message: string }>, tag: typeof busy) => {
    if (busy) return;
    setBusy(tag);
    setProblem(null);
    const result = await fn();
    if (!result.ok) {
      setProblem(result.message);
      setBusy(null);
      return;
    }
    router.refresh();
  };

  if (item.state === "confirmed" && !item.redeemedAt && item.ticket) {
    return (
      <div className="mt-4 border-t border-hairline pt-4 desk:max-w-sm">
        {confirmingCancel ? (
          <div className="rounded-xl border border-line bg-ground p-3">
            <p className="text-[12px] leading-relaxed font-medium text-ink">
              This refunds the traveller in full and frees the slot. Tell them why —
              they&rsquo;ll see it.
            </p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder="e.g. boat engine trouble, can't run it that day"
              className="mt-2 w-full resize-none rounded-lg border border-line bg-surface px-2.5 py-2 text-[12.5px] font-medium"
            />
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                disabled={busy !== null || reason.trim() === ""}
                onClick={() => act(() => cancelPartnerBooking(item.itemId, reason), "cancel")}
                className="flex h-10 flex-1 items-center justify-center rounded-xl bg-warn text-[12.5px] font-bold text-white disabled:opacity-50"
              >
                {busy === "cancel" ? "Cancelling…" : "Cancel & refund"}
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => setConfirmingCancel(false)}
                className="flex h-10 flex-1 items-center justify-center rounded-xl border border-line bg-surface text-[12.5px] font-bold text-ink disabled:opacity-50"
              >
                Never mind
              </button>
            </div>
          </div>
        ) : (
          <>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => act(() => redeemBooking(item.ticket as string), "checkin")}
              className="flex h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-brand text-[13px] font-bold text-white disabled:bg-line disabled:text-muted"
            >
              <QrIcon size={15} />
              {busy === "checkin" ? "Checking in…" : "Check in"}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => setConfirmingCancel(true)}
              className="mt-2 flex h-9 w-full items-center justify-center gap-1.5 text-[12px] font-semibold text-muted"
            >
              <CloseIcon size={12} />
              Cancel this booking
            </button>
          </>
        )}
        {problem && <p className="mt-2 text-[12px] font-medium text-warn">{problem}</p>}
      </div>
    );
  }

  return null;
}

function Thread({
  itemId,
  thread,
  blockedBy,
}: {
  itemId: string;
  thread: PartnerBookingDetail["thread"];
  blockedBy: PartnerBookingDetail["threadBlockedBy"];
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [status, setStatus] = useState(blockedBy);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportSent, setReportSent] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  // Opening the thread marks the traveller's messages (and their bell
  // notifications) read.
  useEffect(() => {
    void markPartnerThreadRead(itemId).then(() => router.refresh());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [thread.length]);

  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setProblem(null);
    const result = await sendPartnerMessage(itemId, body);
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    setText("");
    router.refresh();
  };

  const block = async () => {
    if (actionBusy) return;
    setActionBusy(true);
    setMenuOpen(false);
    const result = await blockPartnerThread(itemId);
    if (result.ok) setStatus("partner");
    setActionBusy(false);
  };

  const unblock = async () => {
    if (actionBusy) return;
    setActionBusy(true);
    const result = await unblockPartnerThread(itemId);
    if (result.ok) setStatus(null);
    setActionBusy(false);
  };

  const submitReport = async () => {
    const reason = reportReason.trim();
    if (!reason || actionBusy) return;
    setActionBusy(true);
    const result = await reportPartnerThread(itemId, reason);
    setActionBusy(false);
    if (result.ok) {
      setReportSent(true);
      setReporting(false);
      setReportReason("");
    }
  };

  const canSend = status === null;

  return (
    <div className="mt-2 desk:max-w-2xl">
      <div className="relative flex justify-end">
        <button
          type="button"
          aria-label="More"
          onClick={() => setMenuOpen((v) => !v)}
          className="flex h-8 w-8 items-center justify-center text-muted"
        >
          <MoreIcon size={18} />
        </button>

        {menuOpen && (
          <>
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setMenuOpen(false)}
              className="fixed inset-0 z-10 cursor-default"
            />
            <div className="absolute top-full right-0 z-20 mt-1 w-[190px] rounded-2xl border border-line bg-surface p-1.5 shadow-xl">
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setReporting(true);
                }}
                className="flex w-full items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-left text-[13px] font-semibold text-ink"
              >
                <FlagIcon size={15} className="shrink-0 text-muted" />
                Report
              </button>
              {status === "partner" ? (
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={unblock}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-left text-[13px] font-semibold text-ink disabled:opacity-50"
                >
                  <BlockIcon size={15} className="shrink-0 text-muted" />
                  Unblock
                </button>
              ) : status === null ? (
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={block}
                  className="flex w-full items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-left text-[13px] font-semibold text-warn disabled:opacity-50"
                >
                  <BlockIcon size={15} className="shrink-0" />
                  Block
                </button>
              ) : null}
            </div>
          </>
        )}
      </div>

      {reporting && (
        <div className="mt-1 rounded-xl border border-line bg-ground p-3.5">
          <p className="text-[12.5px] font-bold text-ink">Report this conversation</p>
          <p className="mt-0.5 text-[11.5px] font-medium text-muted">
            Tell us what happened — our team will look into it.
          </p>
          <textarea
            value={reportReason}
            onChange={(e) => setReportReason(e.target.value)}
            rows={3}
            placeholder="What went wrong?"
            className="mt-2.5 w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[13px] font-medium outline-none focus:border-brand"
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setReporting(false);
                setReportReason("");
              }}
              className="h-9 rounded-xl border border-line px-3.5 text-[12px] font-bold text-muted"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={actionBusy || reportReason.trim() === ""}
              onClick={submitReport}
              className="h-9 rounded-xl bg-brand px-3.5 text-[12px] font-bold text-white disabled:bg-line disabled:text-muted"
            >
              {actionBusy ? "…" : "Send report"}
            </button>
          </div>
        </div>
      )}

      {reportSent && (
        <p className="mt-2 rounded-xl bg-brandsoft px-3.5 py-2.5 text-[12.5px] font-semibold text-brand">
          Reported. Our team will take a look.
        </p>
      )}

      {thread.length === 0 ? (
        <p className="mt-2 text-[12.5px] font-medium text-muted">
          No messages yet. Anything you send reaches the traveller in the app.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {thread.map((m) => (
            <li
              key={m.id}
              className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 ${
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
                {m.stampLabel}
              </p>
            </li>
          ))}
        </ul>
      )}
      <div ref={endRef} />

      {!canSend ? (
        <p className="mt-3 text-[12.5px] leading-relaxed font-medium text-muted">
          {status === "partner"
            ? "You blocked this conversation."
            : "The traveller closed this conversation."}
        </p>
      ) : (
        <>
          <div className="mt-3 flex gap-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send())}
              placeholder="Message the traveller…"
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
        </>
      )}
    </div>
  );
}
