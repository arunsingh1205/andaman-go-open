"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { rupees } from "@/lib/activities";
import { partnerPhotoUrl } from "@/lib/partner-storage";
import {
  KIND_LABEL,
  dayTotal,
  fullySaved,
  timeAfterMove,
  type Booking,
  type BookingDay,
  type BookingKind,
} from "@/lib/bookings";
import { cancelBookingItem } from "@/lib/traveller-cancel";
import {
  getTravellerThread,
  getTravellerThreadStatus,
  sendTravellerMessage,
  markTravellerThreadRead,
  blockTravellerThread,
  unblockTravellerThread,
  reportTravellerThread,
  type TravellerMessage,
} from "@/lib/traveller-messages";
import { leaveReview } from "@/lib/traveller-reviews";
import type { QrCode } from "@/lib/qr";
import DirectionsButton from "@/app/directions-button";
import {
  BlockIcon,
  ChatIcon,
  CarIcon,
  CheckIcon,
  CloseIcon,
  DiveIcon,
  FerryIcon,
  FlagIcon,
  MoreIcon,
  MusicIcon,
  OfflineIcon,
  PinIcon,
  QrIcon,
  RefundIcon,
  ScooterIcon,
  BedIcon,
  StarIcon,
  StormIcon,
  UndoIcon,
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

/** What the traveller chose to do about a weather cancellation. */
type Outcome = "moved" | "refunded";

/** The state a card actually shows, once that choice is taken into account. */
type Shown = "confirmed" | "pending" | "disrupted" | "completed" | "missed" | "refunded";

export default function BookingsList({
  days,
  tickets,
}: {
  days: BookingDay[];
  tickets: Record<string, QrCode>;
}) {
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [openTicket, setOpenTicket] = useState<string | null>(null);
  const [openThread, setOpenThread] = useState<string | null>(null);
  const [openReview, setOpenReview] = useState<string | null>(null);

  const shownDays = days.filter((d) => d.when === tab);

  const ticketItem = days.flatMap((d) => d.items).find((i) => i.id === openTicket) ?? null;
  const ticketDay = days.find((d) => d.items.some((i) => i.id === openTicket)) ?? null;

  const threadItem = days.flatMap((d) => d.items).find((i) => i.id === openThread) ?? null;
  const reviewItem = days.flatMap((d) => d.items).find((i) => i.id === openReview) ?? null;

  useEffect(() => {
    if (!openTicket) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenTicket(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openTicket]);

  const decide = (dayId: string, outcome: Outcome) =>
    setOutcomes((prev) => ({ ...prev, [dayId]: outcome }));

  const undo = (dayId: string) =>
    setOutcomes((prev) => {
      const next = { ...prev };
      delete next[dayId];
      return next;
    });

  return (
    <>
      <div className="flex rounded-[13px] bg-ground p-1 tablet:w-[360px]">
        {(["upcoming", "past"] as const).map((id) => {
          const on = id === tab;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={on}
              onClick={() => setTab(id)}
              className={`h-11 flex-1 rounded-[10px] text-[13px] font-bold capitalize ${
                on ? "bg-surface text-brand shadow-sm" : "text-muted"
              }`}
            >
              {id}
            </button>
          );
        })}
      </div>

      {shownDays.length === 0 ? (
        <p className="mt-12 text-center text-[13.5px] font-medium text-muted">
          {tab === "upcoming"
            ? "Nothing booked yet. Plan a day from the home screen and it lands here."
            : "Nothing finished yet."}
        </p>
      ) : (
        <div className="mt-5 flex flex-col gap-7 lg:mt-8 lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-8 lg:gap-y-10">
          {shownDays.map((day) => {
            const outcome = outcomes[day.id];
            const past = day.when === "past";

            return (
              <section key={day.id}>
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <h2 className="font-display text-[17px] leading-tight font-bold tracking-tight">
                      {day.label} · {day.place}
                    </h2>
                    <p className="mt-0.5 text-[12px] font-medium text-muted">
                      {day.dateLabel} · {day.items.length} bookings ·{" "}
                      {dayTotal(day) === 0 ? "nothing to pay" : rupees(dayTotal(day))}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] font-bold tracking-wide text-muted">
                    {day.refCode}
                  </span>
                </div>

                {fullySaved(day) && !past && (
                  <p className="mt-2 flex items-center gap-1.5 text-[11.5px] font-semibold text-brand">
                    <OfflineIcon size={14} />
                    Tickets saved on this phone — they open with no signal
                  </p>
                )}

                {day.disruption && !past && !outcome && (
                  <div className="mt-3 rounded-card border border-sandline bg-sandsoft p-4">
                    <p className="flex items-center gap-1.5 text-[10.5px] font-bold tracking-wider text-warn uppercase">
                      <StormIcon size={15} />
                      Weather
                    </p>
                    <h3 className="mt-1.5 text-[15px] leading-snug font-bold text-sandink">
                      {day.disruption.headline}
                    </h3>
                    <p className="mt-1.5 text-[12.5px] leading-relaxed font-medium text-sandink2">
                      {day.disruption.detail}
                    </p>

                    <ul className="mt-3 flex flex-col gap-1.5 border-t border-sandline pt-3">
                      {day.disruption.changes.map((change) => {
                        const item = day.items.find((i) => i.id === change.itemId);
                        if (!item) return null;
                        return (
                          <li
                            key={change.itemId}
                            className="flex items-baseline justify-between gap-3 text-[12.5px]"
                          >
                            <span className="min-w-0 truncate font-semibold text-sandink">
                              {item.title}
                            </span>
                            <span className="shrink-0 font-semibold text-sandink2">
                              <span className="line-through opacity-60">{item.timeLabel}</span>
                              {" → "}
                              <span className="text-sandink">{change.timeLabel}</span>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    <p className="mt-2 text-[11.5px] font-medium text-sandink2">
                      Everything else on this day stays exactly where it is.
                    </p>

                    <div className="mt-4 flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={() => decide(day.id, "moved")}
                        className="flex h-12 w-full items-center justify-center rounded-2xl bg-brand px-4 text-center text-[13.5px] font-bold text-white"
                      >
                        {day.disruption.moveLabel}
                        {day.disruption.extraPaise === 0
                          ? " · no extra charge"
                          : ` · +${rupees(day.disruption.extraPaise)}`}
                      </button>
                      <button
                        type="button"
                        onClick={() => decide(day.id, "refunded")}
                        className="flex h-12 w-full items-center justify-center rounded-2xl border border-sandline bg-surface px-4 text-[13.5px] font-bold text-sandink"
                      >
                        Refund the whole day · {rupees(dayTotal(day))}
                      </button>
                    </div>
                  </div>
                )}

                {outcome === "moved" && (
                  <OutcomeCard
                    icon={<CheckIcon size={16} />}
                    tone="brand"
                    title="Moved. Your day now starts at 11:00 AM."
                    body="Both operators have been told. Your reference and your tickets are unchanged — there is nothing to download again."
                    onUndo={() => undo(day.id)}
                  />
                )}

                {outcome === "refunded" && (
                  <OutcomeCard
                    icon={<RefundIcon size={16} />}
                    tone="muted"
                    title={`${rupees(dayTotal(day))} is on its way back`}
                    body="One booking, one refund. Everything below is cancelled and the money reaches the account you paid from in three to five working days."
                    onUndo={() => undo(day.id)}
                  />
                )}

                <ul className="mt-3 flex flex-col gap-2.5">
                  {day.items.map((item) => (
                    <ItemCard
                      key={item.id}
                      item={item}
                      day={day}
                      outcome={outcome}
                      past={past}
                      hasTicket={Boolean(tickets[item.id])}
                      onTicket={() => setOpenTicket(item.id)}
                      onMessage={() => setOpenThread(item.id)}
                      onReview={() => setOpenReview(item.id)}
                    />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {ticketItem && ticketDay && tickets[ticketItem.id] && (
        <TicketSheet
          item={ticketItem}
          day={ticketDay}
          code={tickets[ticketItem.id]}
          onClose={() => setOpenTicket(null)}
        />
      )}

      {threadItem && (
        <MessageSheet item={threadItem} onClose={() => setOpenThread(null)} />
      )}

      {reviewItem && (
        <ReviewSheet item={reviewItem} onClose={() => setOpenReview(null)} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

function OutcomeCard({
  icon,
  tone,
  title,
  body,
  onUndo,
}: {
  icon: ReactNode;
  tone: "brand" | "muted";
  title: string;
  body: string;
  onUndo: () => void;
}) {
  return (
    <div
      className={`mt-3 rounded-card border border-line p-4 ${
        tone === "brand" ? "bg-brandsoft" : "bg-ground"
      }`}
    >
      <p
        className={`flex items-start gap-2 text-[14.5px] leading-snug font-bold ${
          tone === "brand" ? "text-brand" : "text-ink"
        }`}
      >
        <span className="mt-0.5 shrink-0">{icon}</span>
        {title}
      </p>
      <p className="mt-1.5 text-[12.5px] leading-relaxed font-medium text-muted">{body}</p>
      <button
        type="button"
        onClick={onUndo}
        className="mt-3 flex h-11 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-[13px] font-bold text-brand"
      >
        <UndoIcon size={15} />
        Undo
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ItemCard({
  item,
  day,
  outcome,
  past,
  hasTicket,
  onTicket,
  onMessage,
  onReview,
}: {
  item: Booking;
  day: BookingDay;
  outcome: Outcome | undefined;
  past: boolean;
  hasTicket: boolean;
  onTicket: () => void;
  onMessage: () => void;
  onReview: () => void;
}) {
  const Icon = KIND_ICON[item.kind];
  const canReview = item.redeemedAt !== null && item.kind !== "ferry";
  const cancellable =
    !past &&
    !outcome &&
    (item.state === "pending" || item.state === "confirmed") &&
    item.redeemedAt === null;

  const state: Shown =
    outcome === "refunded"
      ? "refunded"
      : outcome === "moved" && item.state === "disrupted"
        ? "confirmed"
        : item.state;

  const time = outcome === "moved" ? timeAfterMove(day, item) : item.timeLabel;
  const timeChanged = time !== item.timeLabel;
  const dimmed = past || state === "refunded" || state === "missed";

  // Row actions. Message survives into the past while a reply is unread; the
  // other two are for upcoming bookings only.
  const canMessage = (!past || item.unreadFromPartner > 0) && state !== "refunded";
  const canDirections = Boolean(item.directions) && !past && state !== "refunded";
  const canShowTicket = hasTicket && !past && state !== "refunded";
  const hasRowActions = canMessage || canDirections || canShowTicket;

  return (
    <li
      className={`rounded-card border p-4 ${
        state === "disrupted"
          ? "border-sandline bg-surface"
          : dimmed
            ? "border-line bg-ground"
            : "border-line bg-surface"
      }`}
    >
      <div className="flex items-start gap-3">
        {item.partnerPhotoPath ? (
          // The operator's own photo once they've set one — a traveller only
          // ever sees this for something they've actually booked (015).
          <Image
            src={partnerPhotoUrl(item.partnerPhotoPath)}
            alt=""
            width={44}
            height={44}
            className={`h-11 w-11 shrink-0 rounded-[13px] object-cover ${dimmed ? "opacity-60" : ""}`}
          />
        ) : (
          <span
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px] ${
              dimmed ? "bg-line text-muted" : "bg-brandsoft text-brand"
            }`}
          >
            <Icon size={21} />
          </span>
        )}

        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold tracking-wider text-muted uppercase">
            {KIND_LABEL[item.kind]}
          </p>
          <p
            className={`mt-0.5 text-[15px] leading-tight font-bold ${
              state === "refunded" ? "text-muted line-through" : ""
            }`}
          >
            {item.title}
          </p>
          {item.kind === "cab" && !item.ticket ? (
            state !== "refunded" && (
              <p className="mt-1 text-[12px] leading-snug font-medium text-muted">
                Driver details will be shared shortly
              </p>
            )
          ) : (
            <>
              <p className="mt-1 text-[12px] leading-snug font-medium text-muted">{item.operator}</p>
              {item.kind === "cab" && item.operatorPhone && (
                <p className="mt-0.5 text-[12px] leading-snug font-bold text-brand">
                  {item.operatorPhone}
                </p>
              )}
            </>
          )}
          <p className="mt-1.5 text-[12.5px] font-semibold">
            {timeChanged ? (
              <>
                <span className="text-muted line-through">{item.timeLabel}</span>{" "}
                <span className="text-brand">{time}</span>
              </>
            ) : (
              <span className={dimmed ? "text-muted" : "text-ink"}>{time}</span>
            )}
            <span className="font-medium text-muted"> · {item.detail}</span>
          </p>
        </div>

        <span
          className={`shrink-0 text-right text-[14px] font-bold ${
            state === "refunded"
              ? "text-muted line-through"
              : dimmed
                ? "text-muted"
                : "text-brand"
          }`}
        >
          {item.pricePaise === 0 ? "Free" : rupees(item.pricePaise)}
        </span>
      </div>

      <div className="mt-3 flex flex-col items-start gap-2.5 border-t border-hairline pt-3">
        <StateChip
          state={state}
          refundStatus={item.state === "refunded" ? item.refundStatus : null}
          hasRefund={item.state === "refunded" && item.refundedPaise > 0}
        />

        {hasRowActions && (
          <div className="flex w-full flex-wrap items-center gap-2">
            {canMessage && (
              <button
                type="button"
                onClick={onMessage}
                className="relative flex h-11 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-[12px] font-bold text-brand"
              >
                <ChatIcon size={15} />
                Message
                {item.unreadFromPartner > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-white">
                    {item.unreadFromPartner}
                  </span>
                )}
              </button>
            )}

            {canDirections && (
              <DirectionsButton
                directions={item.directions!}
                className="flex h-11 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-[12px] font-bold text-brand"
              />
            )}

            {canShowTicket && (
              <button
                type="button"
                onClick={onTicket}
                className="flex h-11 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-[12px] font-bold text-brand"
              >
                <QrIcon size={15} />
                Ticket
              </button>
            )}
          </div>
        )}
      </div>

      {cancellable && <CancelRow item={item} />}

      {canReview && (
        <button
          type="button"
          onClick={onReview}
          className="mt-2.5 flex w-full items-center justify-between gap-2 rounded-xl border border-line bg-ground px-3.5 py-2.5 text-left"
        >
          <span className="text-[12.5px] font-bold text-ink">
            {item.myRating !== null ? "Your review" : "How was it?"}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-flex items-center gap-0.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <StarIcon
                  key={n}
                  size={13}
                  className={
                    item.myRating !== null && n <= item.myRating ? "text-sand" : "text-line"
                  }
                />
              ))}
            </span>
            <span className="text-[11.5px] font-bold text-brand">
              {item.myRating !== null ? "Edit" : "Rate"}
            </span>
          </span>
        </button>
      )}
    </li>
  );
}

function CancelRow({ item }: { item: Booking }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const cancel = async () => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const result = await cancelBookingItem(item.id);
    if (!result.ok) {
      setProblem(result.message);
      setBusy(false);
      return;
    }
    router.refresh();
  };

  const policy =
    item.payMode === "deposit"
      ? "The deposit you paid isn't refundable."
      : item.payMode === "partial"
        ? "The amount you paid online isn't refundable."
        : item.refundIfCancelledPaise > 0
          ? `Cancel now for a ${rupees(item.refundIfCancelledPaise)} refund — half of what you paid.`
          : "Inside 24 hours, a cancellation isn't refunded.";

  return (
    <div className="mt-2.5 border-t border-hairline pt-2.5">
      <p className="text-[11px] font-semibold text-muted">{policy}</p>

      {item.canCancel ? (
        confirming ? (
          <div className="mt-2 rounded-xl border border-sandline bg-sandsoft p-3">
            <p className="text-[12px] leading-relaxed font-medium text-sandink2">
              Cancel this booking? The operator is told, and the slot is freed.
              {item.payMode === "deposit"
                ? " The deposit stays with the operator."
                : item.payMode === "partial"
                  ? " The amount paid online isn't refunded; the driver simply isn't paid the rest."
                  : item.refundIfCancelledPaise > 0
                    ? ` ${rupees(item.refundIfCancelledPaise)} comes back to you.`
                    : " Nothing is refunded at this point."}
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={cancel}
                className="h-9 flex-1 rounded-lg bg-warn text-[12px] font-bold text-white disabled:opacity-50"
              >
                {busy ? "Cancelling…" : "Yes, cancel"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirming(false)}
                className="h-9 flex-1 rounded-lg border border-sandline bg-surface text-[12px] font-bold text-sandink disabled:opacity-50"
              >
                Keep it
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="mt-1.5 text-[12px] font-bold text-warn"
          >
            Cancel this booking
          </button>
        )
      ) : (
        <p className="mt-1.5 text-[12px] font-medium text-muted">
          This booking can no longer be cancelled here. Message the operator if you need to.
        </p>
      )}

      {problem && <p className="mt-1.5 text-[11.5px] font-medium text-warn">{problem}</p>}
    </div>
  );
}

function StateChip({
  state,
  refundStatus,
  hasRefund,
}: {
  state: Shown;
  /** Real Razorpay status, when there was an online payment to reverse —
   *  null covers both "nothing to refund" and "not cancelled". */
  refundStatus?: "processing" | "processed" | "failed" | null;
  /** True only when refunded_paise > 0 — an actual gateway refund is owed.
   *  A cab's commission-online payment, a forfeited deposit, and an
   *  inside-24-hours cancel all land in state 'refunded' with nothing owed
   *  back, so the plain "Refunded" label (which reads as money already
   *  moved) would be wrong for them — same trap already called out in
   *  partner-bookings-list.tsx's version of this chip. */
  hasRefund?: boolean;
}) {
  const base =
    "flex min-w-0 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11.5px] font-semibold";

  if (state === "disrupted") {
    return (
      <span className={`${base} bg-sandsoft text-warn`}>
        <StormIcon size={13} />
        Cancelled — weather
      </span>
    );
  }

  if (state === "refunded") {
    if (refundStatus === "processing") {
      return (
        <span className={`${base} bg-sandsoft text-warn`}>
          <RefundIcon size={13} />
          Refund processing
        </span>
      );
    }
    if (refundStatus === "failed") {
      return (
        <span className={`${base} bg-sandsoft text-warn`}>
          <RefundIcon size={13} />
          Refund failed — contact support
        </span>
      );
    }
    if (!hasRefund) {
      return (
        <span className={`${base} bg-line text-muted`}>
          <StormIcon size={13} />
          Cancelled
        </span>
      );
    }
    return (
      <span className={`${base} bg-line text-muted`}>
        <RefundIcon size={13} />
        Refunded
      </span>
    );
  }

  if (state === "missed") {
    return (
      <span className={`${base} bg-line text-muted`}>
        <StormIcon size={13} />
        Rained off
      </span>
    );
  }

  if (state === "completed") {
    return (
      <span className={`${base} bg-line text-muted`}>
        <CheckIcon size={13} />
        Completed
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

// ---------------------------------------------------------------------------

function TicketSheet({
  item,
  day,
  code,
  onClose,
}: {
  item: Booking;
  day: BookingDay;
  code: QrCode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center tablet:items-center">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-ink/40"
      />

      <div
        role="dialog"
        aria-modal="true"
        className="no-bar relative z-10 flex max-h-[92vh] w-full max-w-[430px] flex-col overflow-y-auto rounded-t-sheet bg-surface tablet:max-w-[520px] tablet:rounded-sheet tablet:shadow-float"
      >
        <div className="flex items-start gap-3 border-b border-hairline px-5 pt-5 pb-4">
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-[19px] leading-tight font-bold tracking-tight">
              {item.title}
            </h2>
            <p className="mt-0.5 text-[12.5px] font-medium text-muted">{item.operator}</p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="-mt-1 -mr-2 flex h-11 w-11 shrink-0 items-center justify-center text-muted"
          >
            <CloseIcon size={20} />
          </button>
        </div>

        <div className="px-5 py-5">
          <div className="mx-auto max-w-[280px] rounded-[22px] border border-line bg-white p-5">
            <svg
              viewBox={`0 0 ${code.size} ${code.size}`}
              shapeRendering="crispEdges"
              className="block w-full text-ink"
              role="img"
              aria-label={`Ticket code ${item.ticket}`}
            >
              <path d={code.path} fill="currentColor" />
            </svg>
          </div>

          <p className="font-display mt-4 text-center text-[20px] font-bold tracking-[0.12em]">
            {item.ticket}
          </p>
          <p className="mt-1 text-center text-[12.5px] font-medium text-muted">
            {day.label} · {item.timeLabel} · {item.detail}
          </p>

          <div className="mt-5 flex flex-col gap-2.5 rounded-card border border-line bg-ground p-4">
            <p className="flex items-start gap-2 text-[12.5px] leading-relaxed font-medium text-ink">
              <OfflineIcon size={16} className="mt-0.5 shrink-0 text-brand" />
              {item.savedOffline
                ? "Saved on this phone. It opens with no signal — which is most of Havelock."
                : "Not saved yet. Open this once on wifi and it stays on your phone."}
            </p>
            <p className="text-[12px] leading-relaxed font-medium text-muted">
              Show it to {item.operator.split(" · ")[0]}. Your whole day sits under one
              reference, {day.refCode} — quote that if anything goes wrong.
            </p>
          </div>

          {item.balancePaise > 0 && (
            <p className="mt-3 flex items-center gap-2 rounded-xl bg-sandsoft px-3.5 py-2.5 text-[13px] font-bold text-sandink2">
              <RefundIcon size={15} className="shrink-0" />
              Pay {rupees(item.balancePaise)} here — the rest is owed in person
            </p>
          )}

          <button
            type="button"
            onClick={onClose}
            className="mt-5 h-13 w-full rounded-2xl bg-brand text-[15px] font-bold text-white"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function MessageSheet({ item, onClose }: { item: Booking; onClose: () => void }) {
  const [thread, setThread] = useState<TravellerMessage[] | null>(null);
  // null = open, else who closed it (152) — "traveller" means this person
  // blocked it themselves; "partner" means the operator did.
  const [status, setStatus] = useState<"traveller" | "partner" | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportSent, setReportSent] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const refresh = () => getTravellerThread(item.id).then(setThread);

  useEffect(() => {
    let alive = true;
    getTravellerThread(item.id).then((m) => {
      if (alive) setThread(m);
    });
    getTravellerThreadStatus(item.id).then((s) => {
      if (alive) setStatus(s);
    });
    void markTravellerThreadRead(item.id);

    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      alive = false;
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [thread?.length]);

  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setProblem(null);
    const result = await sendTravellerMessage(item.id, body);
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    setText("");
    await refresh();
  };

  const block = async () => {
    if (actionBusy) return;
    setActionBusy(true);
    setMenuOpen(false);
    const result = await blockTravellerThread(item.id);
    if (result.ok) setStatus("traveller");
    setActionBusy(false);
  };

  const unblock = async () => {
    if (actionBusy) return;
    setActionBusy(true);
    const result = await unblockTravellerThread(item.id);
    if (result.ok) setStatus(null);
    setActionBusy(false);
  };

  const submitReport = async () => {
    const reason = reportReason.trim();
    if (!reason || actionBusy) return;
    setActionBusy(true);
    const result = await reportTravellerThread(item.id, reason);
    setActionBusy(false);
    if (result.ok) {
      setReportSent(true);
      setReporting(false);
      setReportReason("");
    }
  };

  const canSend = status === null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center tablet:items-center">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-ink/40" />

      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 flex h-[80vh] w-full max-w-[430px] flex-col rounded-t-sheet bg-surface tablet:h-[640px] tablet:max-h-[88vh] tablet:max-w-[520px] tablet:rounded-sheet tablet:shadow-float"
      >
        <div className="flex items-start gap-3 border-b border-hairline px-5 pt-5 pb-4">
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-[17px] leading-tight font-bold tracking-tight">
              {item.operator.split(" · ")[0] || "Operator"}
            </h2>
            <p className="mt-0.5 text-[12px] font-medium text-muted">{item.title}</p>
          </div>

          <div className="relative shrink-0">
            <button
              type="button"
              aria-label="More"
              onClick={() => setMenuOpen((v) => !v)}
              className="-mt-1 flex h-11 w-11 items-center justify-center text-muted"
            >
              <MoreIcon size={20} />
            </button>

            {menuOpen && (
              <>
                <button
                  type="button"
                  aria-label="Close menu"
                  onClick={() => setMenuOpen(false)}
                  className="fixed inset-0 z-10 cursor-default"
                />
                <div className="absolute top-full right-0 z-20 mt-1 w-[200px] rounded-2xl border border-line bg-surface p-1.5 shadow-xl">
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setReporting(true);
                    }}
                    className="flex w-full items-center gap-2.5 rounded-xl px-3.5 py-3 text-left text-[13.5px] font-semibold text-ink"
                  >
                    <FlagIcon size={16} className="shrink-0 text-muted" />
                    Report
                  </button>
                  {status === "traveller" ? (
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={unblock}
                      className="flex w-full items-center gap-2.5 rounded-xl px-3.5 py-3 text-left text-[13.5px] font-semibold text-ink disabled:opacity-50"
                    >
                      <BlockIcon size={16} className="shrink-0 text-muted" />
                      Unblock
                    </button>
                  ) : status === null ? (
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={block}
                      className="flex w-full items-center gap-2.5 rounded-xl px-3.5 py-3 text-left text-[13.5px] font-semibold text-warn disabled:opacity-50"
                    >
                      <BlockIcon size={16} className="shrink-0" />
                      Block
                    </button>
                  ) : null}
                </div>
              </>
            )}
          </div>

          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="-mt-1 -mr-2 flex h-11 w-11 shrink-0 items-center justify-center text-muted"
          >
            <CloseIcon size={20} />
          </button>
        </div>

        {reporting && (
          <div className="border-b border-hairline px-5 py-4">
            <p className="text-[12.5px] font-bold text-ink">Report this conversation</p>
            <p className="mt-0.5 text-[11.5px] font-medium text-muted">
              Tell us what happened — our team will look into it.
            </p>
            <textarea
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              rows={3}
              placeholder="What went wrong?"
              className="mt-2.5 w-full rounded-xl border border-line bg-ground px-3.5 py-2.5 text-[13px] font-medium outline-none focus:border-brand"
            />
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setReporting(false);
                  setReportReason("");
                }}
                className="h-10 rounded-xl border border-line px-3.5 text-[12.5px] font-bold text-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionBusy || reportReason.trim() === ""}
                onClick={submitReport}
                className="h-10 rounded-xl bg-brand px-3.5 text-[12.5px] font-bold text-white disabled:bg-line disabled:text-muted"
              >
                {actionBusy ? "…" : "Send report"}
              </button>
            </div>
          </div>
        )}

        <div className="no-bar flex-1 overflow-y-auto px-5 py-4">
          {reportSent && (
            <p className="mb-3 rounded-xl bg-brandsoft px-3.5 py-2.5 text-[12.5px] font-semibold text-brand">
              Reported. Our team will take a look.
            </p>
          )}
          {thread === null ? (
            <p className="text-center text-[12.5px] font-medium text-muted">Loading…</p>
          ) : thread.length === 0 ? (
            <p className="text-center text-[12.5px] font-medium text-muted">
              No messages yet. Ask the operator anything about your booking.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {thread.map((m) => (
                <li
                  key={m.id}
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 ${
                    m.fromTraveller
                      ? "self-end bg-brand text-white"
                      : "self-start border border-line bg-ground text-ink"
                  }`}
                >
                  <p className="text-[13px] leading-snug font-medium whitespace-pre-wrap">{m.body}</p>
                  <p
                    className={`mt-1 text-[10px] font-semibold ${
                      m.fromTraveller ? "text-white/70" : "text-muted"
                    }`}
                  >
                    {m.stampLabel}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <div ref={endRef} />
        </div>

        <div className="border-t border-hairline px-5 pt-3 pb-6">
          {!canSend ? (
            <p className="text-center text-[12.5px] leading-relaxed font-medium text-muted">
              {status === "traveller"
                ? "You blocked this conversation."
                : "This operator has closed this conversation."}
            </p>
          ) : (
            <>
              {problem && <p className="mb-2 text-[11.5px] font-medium text-warn">{problem}</p>}
              <div className="flex gap-2">
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send())}
                  placeholder="Message the operator…"
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ReviewSheet({ item, onClose }: { item: Booking; onClose: () => void }) {
  const router = useRouter();
  const [rating, setRating] = useState(item.myRating ?? 0);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async () => {
    if (rating < 1 || busy) return;
    setBusy(true);
    setProblem(null);
    const result = await leaveReview(item.id, rating, body);
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    router.refresh();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center tablet:items-center">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-ink/40" />

      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 w-full max-w-[430px] rounded-t-sheet bg-surface px-5 pt-5 pb-7 tablet:max-w-[520px] tablet:rounded-sheet tablet:shadow-float"
      >
        <div className="flex items-start gap-3 border-b border-hairline pb-4">
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-[17px] leading-tight font-bold tracking-tight">
              {item.myRating !== null ? "Edit your review" : "Rate this booking"}
            </h2>
            <p className="mt-0.5 text-[12px] font-medium text-muted">
              {item.title} · {item.operator.split(" · ")[0]}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="-mt-1 -mr-2 flex h-11 w-11 shrink-0 items-center justify-center text-muted"
          >
            <CloseIcon size={20} />
          </button>
        </div>

        <div className="mt-4 flex justify-center gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              aria-label={`${n} star${n === 1 ? "" : "s"}`}
              onClick={() => setRating(n)}
              className="p-1"
            >
              <StarIcon size={30} className={n <= rating ? "text-sand" : "text-line"} />
            </button>
          ))}
        </div>

        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          placeholder="Anything you'd tell another traveller? (optional)"
          className="mt-4 w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[13.5px] font-medium outline-none focus:border-brand"
        />

        {problem && <p className="mt-2 text-[11.5px] font-medium text-warn">{problem}</p>}

        <button
          type="button"
          disabled={busy || rating < 1}
          onClick={submit}
          className="mt-4 h-12 w-full rounded-2xl bg-brand text-[14px] font-bold text-white disabled:bg-line disabled:text-muted"
        >
          {busy ? "Saving…" : item.myRating !== null ? "Update review" : "Post review"}
        </button>
      </div>
    </div>
  );
}
