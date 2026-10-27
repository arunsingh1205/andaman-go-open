"use client";

// Today's confirmed arrivals as a tap-list. Check someone in without typing
// their code; drop the party count if fewer showed; mark a no-show once
// their time has passed. Every action is a server RPC (029 / 005) then a
// refresh — acting here and from the Bookings tab leave the same state.
//
// "Checked in" also carries its own Undo (051), same as a no-show does — a
// mis-tap in the middle of a busy check-in line shouldn't need a support
// ticket to fix, as long as it's caught the same day.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KIND_LABEL, type BookingKind } from "@/lib/bookings";
import { redeemBooking, undoRedeemBookingItem } from "@/lib/partner-redeem";
import { adjustParty, clearNoShow, markNoShow, type TodayArrivals } from "@/lib/partner-checkin";
import type { PartnerBooking } from "@/lib/partner-bookings";
import {
  CarIcon,
  CheckIcon,
  ClockIcon,
  CloseIcon,
  DiveIcon,
  FerryIcon,
  MusicIcon,
  BedIcon,
  PinIcon,
  ScooterIcon,
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

export default function TodayArrivalsList({ arrivals }: { arrivals: TodayArrivals }) {
  const { toCheckIn, done, noShows } = arrivals;
  const empty = toCheckIn.length === 0 && done.length === 0 && noShows.length === 0;

  return (
    <div className="mt-5">
      {empty ? (
        <p className="text-[13px] font-medium text-muted">
          Nothing confirmed for today. Use the code box below for walk-ins.
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          {toCheckIn.length > 0 && (
            <section>
              <GroupTitle>To check in · {toCheckIn.length}</GroupTitle>
              <ul className="mt-2 flex flex-col gap-2">
                {toCheckIn.map((b) => (
                  <ArrivalCard key={b.itemId} booking={b} />
                ))}
              </ul>
            </section>
          )}

          {done.length > 0 && (
            <section>
              <GroupTitle>Checked in · {done.length}</GroupTitle>
              <ul className="mt-2 flex flex-col gap-2">
                {done.map((b) => (
                  <DoneCard key={b.itemId} booking={b} />
                ))}
              </ul>
            </section>
          )}

          {noShows.length > 0 && (
            <section>
              <GroupTitle>No-shows · {noShows.length}</GroupTitle>
              <ul className="mt-2 flex flex-col gap-2">
                {noShows.map((b) => (
                  <NoShowCard key={b.itemId} booking={b} />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function GroupTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[11px] font-bold tracking-wider text-muted uppercase">{children}</h3>;
}

function ArrivalCard({ booking }: { booking: PartnerBooking }) {
  const router = useRouter();
  const Icon = KIND_ICON[booking.kind];
  const [busy, setBusy] = useState<"in" | "no" | "party" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [editingParty, setEditingParty] = useState(false);

  const act = async (
    tag: "in" | "no" | "party",
    fn: () => Promise<{ ok: boolean; message: string }>,
  ) => {
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

  return (
    <li className="rounded-[16px] border border-line bg-surface p-3.5 desk:rounded-xl desk:p-3">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-brandsoft text-brand desk:h-9 desk:w-9 desk:rounded-lg">
          <Icon size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold tracking-wider text-muted uppercase">
            {KIND_LABEL[booking.kind]}
          </p>
          <p className="truncate text-[13.5px] leading-tight font-bold">{booking.title}</p>
          <p className="mt-0.5 text-[12px] font-semibold text-ink">
            {booking.timeLabel}
            <button
              type="button"
              onClick={() => setEditingParty((v) => !v)}
              className="ml-1.5 font-medium text-brand underline underline-offset-2"
            >
              {booking.detail}
            </button>
          </p>
        </div>
      </div>

      {editingParty && booking.party > 1 && (
        <div className="mt-2.5 rounded-[14px] bg-ground p-2.5 desk:rounded-lg">
          <p className="text-[11px] font-bold text-muted">How many actually came?</p>
          <div className="mt-1.5 flex gap-1.5">
            {Array.from({ length: booking.party }, (_, n) => n + 1).map((n) => (
              <button
                key={n}
                type="button"
                disabled={busy !== null}
                onClick={() => {
                  if (n === booking.party) {
                    setEditingParty(false);
                    return;
                  }
                  setEditingParty(false);
                  void act("party", () => adjustParty(booking.itemId, n));
                }}
                className={`h-9 w-9 rounded-lg text-[13px] font-bold ${
                  n === booking.party
                    ? "bg-brand text-white"
                    : "border border-line bg-surface text-ink"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-2.5 flex gap-2 border-t border-hairline pt-2.5">
        <button
          type="button"
          disabled={busy !== null || !booking.ticket}
          onClick={() => act("in", () => redeemBooking(booking.ticket as string))}
          className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand text-[12.5px] font-bold text-white disabled:bg-line disabled:text-muted"
        >
          <CheckIcon size={14} />
          {busy === "in" ? "Checking in…" : "Check in"}
        </button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => act("no", () => markNoShow(booking.itemId))}
          className="flex h-10 items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[12px] font-bold text-muted disabled:opacity-50"
        >
          <CloseIcon size={12} />
          {busy === "no" ? "…" : "No-show"}
        </button>
      </div>
      {problem && <p className="mt-2 text-[11.5px] font-medium text-warn">{problem}</p>}
    </li>
  );
}

function DoneCard({ booking }: { booking: PartnerBooking }) {
  const router = useRouter();
  const Icon = KIND_ICON[booking.kind];
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const undo = async () => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const result = await undoRedeemBookingItem(booking.itemId);
    if (result.ok) {
      router.refresh();
      return;
    }
    setProblem(result.message);
    setBusy(false);
  };

  return (
    <li className="flex flex-col gap-1 rounded-[16px] border border-line bg-ground p-3.5 desk:rounded-xl desk:p-3">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-line text-muted desk:h-8 desk:w-8 desk:rounded-lg">
          <Icon size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-bold text-muted">{booking.title}</p>
          <p className="text-[11px] font-medium text-muted">{booking.detail}</p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={undo}
          className="h-8 shrink-0 rounded-lg border border-line bg-surface px-3 text-[11.5px] font-bold text-ink disabled:opacity-50"
        >
          {busy ? "…" : "Undo"}
        </button>
      </div>
      {problem && <p className="text-[11px] font-medium text-warn">{problem}</p>}
    </li>
  );
}

function NoShowCard({ booking }: { booking: PartnerBooking }) {
  const router = useRouter();
  const Icon = KIND_ICON[booking.kind];
  const [busy, setBusy] = useState(false);

  const undo = async () => {
    if (busy) return;
    setBusy(true);
    const result = await clearNoShow(booking.itemId);
    if (result.ok) router.refresh();
    else setBusy(false);
  };

  return (
    <li className="flex items-center gap-3 rounded-[16px] border border-line bg-ground p-3.5 desk:rounded-xl desk:p-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-line text-muted desk:h-8 desk:w-8 desk:rounded-lg">
        <Icon size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] font-bold text-muted">{booking.title}</p>
        <p className="flex items-center gap-1 text-[11px] font-medium text-muted">
          <ClockIcon size={11} />
          {booking.timeLabel} · didn&rsquo;t show
        </p>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={undo}
        className="h-8 shrink-0 rounded-lg border border-line bg-surface px-3 text-[11.5px] font-bold text-ink disabled:opacity-50"
      >
        {busy ? "…" : "Undo"}
      </button>
    </li>
  );
}
