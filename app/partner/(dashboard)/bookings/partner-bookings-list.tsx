"use client";

// The core of the partner app: everything headed this business's way, the
// way a restaurant sees incoming orders. No timer, no reassignment, no
// accept/decline — a booking arrives already paid and confirmed (034). All
// this screen does is make sure nothing gets missed, check people in, and
// let a partner cancel one they genuinely can't run (which refunds the
// traveller in full).
//
// Check-in here asks first, rather than firing off the one tap it used to —
// this list can hold weeks of confirmed bookings, and a stray tap while
// scrolling used to check someone in for real. The button also only shows
// up once a booking's day has arrived; a card for Sunday has no business
// saying "Checked in" on a Thursday. A same-day mistake still has a way
// back: "Undo check-in" (051), while it's still today.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { rupees } from "@/lib/activities";
import { dayKey, todayIST } from "@/lib/date";
import { istDayKey } from "@/lib/partner-format";
import { KIND_LABEL, type BookingKind, type BookingState } from "@/lib/bookings";
import { cancelPartnerBooking } from "@/lib/partner-actions";
import { redeemBooking, undoRedeemBookingItem } from "@/lib/partner-redeem";
import type { PartnerBooking } from "@/lib/partner-bookings";
import {
  CarIcon,
  CheckIcon,
  ChatIcon,
  CloseIcon,
  DiveIcon,
  FerryIcon,
  MusicIcon,
  PinIcon,
  QrIcon,
  BedIcon,
  ScooterIcon,
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

// One day's worth of bookings, keyed by IST calendar day — built off the
// list the server already sorted by starts_at, so groups come out in date
// order for free.
type DayGroup = { dayKey: string; label: string; items: PartnerBooking[] };

function groupByDay(items: PartnerBooking[]): DayGroup[] {
  const byKey = new Map<string, DayGroup>();
  for (const b of items) {
    const key = istDayKey(b.startsAtIso);
    const group = byKey.get(key);
    if (group) group.items.push(b);
    else byKey.set(key, { dayKey: key, label: b.dateLabel, items: [b] });
  }
  return [...byKey.values()];
}

export default function PartnerBookingsList({ bookings }: { bookings: PartnerBooking[] }) {
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");
  const [dayFilter, setDayFilter] = useState<string>("all");
  const shown = bookings.filter((b) => b.when === tab);
  const groups = groupByDay(shown);
  const filteredGroups = dayFilter === "all" ? groups : groups.filter((g) => g.dayKey === dayFilter);

  return (
    <>
      <div className="mt-4 flex rounded-[13px] bg-ground p-1 desk:max-w-xs">
        {(["upcoming", "past"] as const).map((id) => {
          const on = id === tab;
          const count = bookings.filter((b) => b.when === id).length;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={on}
              onClick={() => {
                setTab(id);
                setDayFilter("all");
              }}
              className={`h-11 flex-1 rounded-[10px] text-[13px] font-bold capitalize ${
                on ? "bg-surface text-brand shadow-sm" : "text-muted"
              }`}
            >
              {id}
              {count > 0 && <span className="opacity-60"> · {count}</span>}
            </button>
          );
        })}
      </div>

      {groups.length > 1 && (
        <div className="mt-3 -mx-5 flex gap-1.5 overflow-x-auto px-5 pb-1 desk:mx-0 desk:flex-wrap desk:px-0">
          <button
            type="button"
            aria-pressed={dayFilter === "all"}
            onClick={() => setDayFilter("all")}
            className={`h-8 shrink-0 rounded-full px-3 text-[12px] font-bold ${
              dayFilter === "all" ? "bg-brand text-white" : "border border-line bg-surface text-muted"
            }`}
          >
            All · {shown.length}
          </button>
          {groups.map((g) => (
            <button
              key={g.dayKey}
              type="button"
              aria-pressed={dayFilter === g.dayKey}
              onClick={() => setDayFilter(g.dayKey)}
              className={`h-8 shrink-0 rounded-full px-3 text-[12px] font-bold ${
                dayFilter === g.dayKey
                  ? "bg-brand text-white"
                  : "border border-line bg-surface text-muted"
              }`}
            >
              {g.label} · {g.items.length}
            </button>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <p className="mt-12 text-center text-[13.5px] font-medium text-muted">
          {tab === "upcoming"
            ? "Nothing booked yet. New bookings show up here the moment a traveller makes one."
            : "Nothing here yet."}
        </p>
      ) : (
        <div className="mt-5 flex flex-col gap-6">
          {filteredGroups.map((g) => (
            <section key={g.dayKey}>
              {dayFilter === "all" && (
                <h3 className="mb-2.5 flex items-baseline gap-1.5 text-[12.5px] font-bold text-muted">
                  {g.label}
                  <span className="font-medium opacity-70">· {g.items.length}</span>
                </h3>
              )}
              <ul className="grid gap-2.5 tablet:grid-cols-2 desk:grid-cols-2 xl:grid-cols-3">
                {g.items.map((b) => (
                  <BookingCard key={b.itemId} booking={b} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

function BookingCard({ booking }: { booking: PartnerBooking }) {
  const router = useRouter();
  const Icon = KIND_ICON[booking.kind];
  const [busy, setBusy] = useState<"cancel" | "checkin" | "undo" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [confirmingCheckin, setConfirmingCheckin] = useState(false);
  const [reason, setReason] = useState("");

  const todayKey = dayKey(todayIST());
  // A card for Sunday has no business being checked in on a Thursday — the
  // button only shows once the booking's own day has arrived.
  const dayHasArrived = istDayKey(booking.startsAtIso) <= todayKey;
  const canUndo = booking.redeemedAt !== null && istDayKey(booking.redeemedAt) === todayKey;

  const cancel = async () => {
    if (busy) return;
    setBusy("cancel");
    setProblem(null);

    const result = await cancelPartnerBooking(booking.itemId, reason);

    if (!result.ok) {
      setProblem(result.message);
      setBusy(null);
      return;
    }

    // The server component above reads bookings fresh on every request —
    // refresh is what turns this card into whatever it looks like now that
    // the database has moved on (cancelled, or gone from Upcoming entirely).
    router.refresh();
  };

  // A confirmed booking already carries its own ticket code — the same code
  // the Check-in tab asks a partner to type in by hand. No reason to make
  // them go find it and retype it when it's sitting right here on the card.
  const checkIn = async () => {
    if (busy || !booking.ticket) return;
    setBusy("checkin");
    setProblem(null);

    const result = await redeemBooking(booking.ticket);
    setConfirmingCheckin(false);

    if (!result.ok) {
      setProblem(result.message);
      setBusy(null);
      return;
    }

    router.refresh();
  };

  const undoCheckIn = async () => {
    if (busy) return;
    setBusy("undo");
    setProblem(null);

    const result = await undoRedeemBookingItem(booking.itemId);

    if (!result.ok) {
      setProblem(result.message);
      setBusy(null);
      return;
    }

    router.refresh();
  };

  return (
    <li className="rounded-[18px] border border-line bg-surface p-4 shadow-sm transition-shadow desk:hover:shadow-md">
      <Link href={`/partner/bookings/${booking.itemId}`} className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px] bg-brandsoft text-brand">
          <Icon size={21} />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold tracking-wider text-muted uppercase">
            {KIND_LABEL[booking.kind]}
          </p>
          <p className="mt-0.5 text-[15px] leading-tight font-bold">{booking.title}</p>
          <p className="mt-1.5 text-[12.5px] font-semibold text-ink">
            {booking.dateLabel} · {booking.timeLabel}
            <span className="font-medium text-muted"> · {booking.detail}</span>
          </p>
        </div>

        <span className="shrink-0 text-right text-[14px] font-bold text-brand">
          {booking.pricePaise === 0 ? "Free" : rupees(booking.pricePaise)}
        </span>
      </Link>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-hairline pt-3">
        <StateChip
          state={booking.state}
          redeemed={booking.redeemedAt !== null}
          cancelledNote={booking.cancelledNote}
        />
        <div className="flex shrink-0 items-center gap-2">
          {booking.unreadFromTraveller > 0 && (
            <span className="flex items-center gap-1 rounded-full bg-brand px-2 py-1 text-[10px] font-bold text-white">
              <ChatIcon size={11} />
              {booking.unreadFromTraveller}
            </span>
          )}
          <span className="rounded-full border border-line bg-ground px-2.5 py-1 text-[11px] font-bold tracking-wide text-muted">
            {booking.refCode}
          </span>
        </div>
      </div>

      {booking.cancelledNote && (
        <div className="mt-2.5 rounded-[14px] border border-sandline bg-sandsoft px-3 py-2.5 desk:rounded-xl">
          <p className="text-[11px] font-bold tracking-wider text-sandink uppercase">
            Why it was cancelled
          </p>
          <p className="mt-1 text-[12.5px] leading-relaxed font-medium text-sandink2">
            {booking.cancelledNote}
          </p>
        </div>
      )}

      {(booking.contactPhone || booking.contactEmail) && (
        <div className="mt-2.5 flex flex-col gap-1 border-t border-hairline pt-2.5">
          {booking.contactPhone && (
            <p className="flex items-center gap-1.5 text-[12px] font-medium text-muted">
              <ChatIcon size={13} />
              {booking.contactPhone}
            </p>
          )}
          {booking.contactEmail && (
            <p className="flex items-center gap-1.5 text-[12px] font-medium text-muted">
              <ChatIcon size={13} />
              {booking.contactEmail}
            </p>
          )}
        </div>
      )}

      {booking.state === "confirmed" && !booking.redeemedAt && booking.ticket && (
        <div className="mt-3 border-t border-hairline pt-3">
          {confirmingCancel ? (
            <div className="rounded-[16px] border border-line bg-ground p-3 desk:rounded-xl">
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
                  onClick={cancel}
                  className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-warn text-[12.5px] font-bold text-white disabled:opacity-50"
                >
                  {busy === "cancel" ? "Cancelling…" : "Cancel & refund"}
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => setConfirmingCancel(false)}
                  className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-line bg-surface text-[12.5px] font-bold text-ink disabled:opacity-50"
                >
                  Never mind
                </button>
              </div>
            </div>
          ) : confirmingCheckin ? (
            <div className="rounded-[16px] border border-line bg-ground p-3 desk:rounded-xl">
              <p className="text-[12px] leading-relaxed font-medium text-ink">
                Check {booking.title} in for {booking.detail}? This says the traveller has
                actually arrived.
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={checkIn}
                  className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-brand text-[12.5px] font-bold text-white disabled:opacity-50"
                >
                  {busy === "checkin" ? "Checking in…" : "Yes, check in"}
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => setConfirmingCheckin(false)}
                  className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-line bg-surface text-[12.5px] font-bold text-ink disabled:opacity-50"
                >
                  Never mind
                </button>
              </div>
            </div>
          ) : (
            <>
              {dayHasArrived ? (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => setConfirmingCheckin(true)}
                  className="flex h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-brand text-[13px] font-bold text-white disabled:bg-line disabled:text-muted"
                >
                  <QrIcon size={15} />
                  Check in
                </button>
              ) : (
                <p className="flex h-11 w-full items-center justify-center rounded-xl bg-ground text-[12px] font-semibold text-muted">
                  Check-in opens {booking.dateLabel}
                </p>
              )}
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
      )}

      {canUndo && (
        <div className="mt-3 border-t border-hairline pt-3">
          <button
            type="button"
            disabled={busy !== null}
            onClick={undoCheckIn}
            className="flex h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-line bg-surface text-[12px] font-bold text-muted disabled:opacity-50"
          >
            <UndoIcon size={13} />
            {busy === "undo" ? "Undoing…" : "Undo check-in — didn't actually show"}
          </button>
          {problem && <p className="mt-2 text-[12px] font-medium text-warn">{problem}</p>}
        </div>
      )}
    </li>
  );
}

function StateChip({
  state,
  redeemed,
  cancelledNote,
}: {
  state: BookingState;
  redeemed: boolean;
  cancelledNote?: string | null;
}) {
  const base =
    "flex min-w-0 items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11.5px] font-semibold";

  if (redeemed) {
    return (
      <span className={`${base} bg-line text-muted`}>
        <CheckIcon size={13} />
        Checked in
      </span>
    );
  }

  if (state === "disrupted") {
    return (
      <span className={`${base} bg-sandsoft text-warn`}>
        <StormIcon size={13} />
        Cancelled — weather
      </span>
    );
  }

  if (state === "refunded") {
    // "Refunded" is the database's word for it and it's misleading here —
    // no money has moved, and to a partner it reads like an accounting
    // event rather than "this isn't happening". If an admin cancelled it,
    // say so plainly; otherwise keep the neutral wording, because then the
    // partner declined it themselves and already knows why.
    return (
      <span className={`${base} ${cancelledNote ? "bg-sandsoft text-sandink2" : "bg-line text-muted"}`}>
        <StormIcon size={13} />
        {cancelledNote ? "Cancelled by Andaman Go" : "Cancelled"}
      </span>
    );
  }

  if (state === "missed" || state === "completed") {
    return (
      <span className={`${base} bg-line text-muted`}>
        <CheckIcon size={13} />
        {state === "missed" ? "No-show" : "Completed"}
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
