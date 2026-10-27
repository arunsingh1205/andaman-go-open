"use client";

// The Calendar tab. Two jobs now:
//
//   1. Show every booking grouped by real IST day (unchanged — it regroups
//      what getPartnerBookings() already returns).
//   2. Let a partner close a date — one activity or trip at a time, or the
//      whole day for weather. Writes go through 021-listing-closures.sql;
//      after each one we router.refresh() so the server re-reads the
//      closures and the grid redraws.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { rupees } from "@/lib/activities";
import { KIND_LABEL, type BookingKind } from "@/lib/bookings";
import { groupBookingsByDay } from "@/lib/partner-calendar";
import {
  closePartnerDate,
  reopenPartnerDate,
  weatherClosePartner,
  type CloseableListing,
  type PartnerClosure,
} from "@/lib/partner-closures";
import type { PartnerRole } from "../partner-nav-tabs";
import type { PartnerBooking } from "@/lib/partner-bookings";
import {
  BedIcon,
  CarIcon,
  ChevronIcon,
  DiveIcon,
  FerryIcon,
  MusicIcon,
  PinIcon,
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

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

function dayKeyOf(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export default function CalendarView({
  bookings,
  closeable,
  closures,
  todayKey,
  role,
}: {
  bookings: PartnerBooking[];
  closeable: CloseableListing[];
  closures: PartnerClosure[];
  todayKey: string;
  role: PartnerRole;
}) {
  const grouped = useMemo(() => groupBookingsByDay(bookings), [bookings]);

  // Every date that has at least one closure, for the grid marker.
  const closedDays = useMemo(
    () => new Set(closures.map((c) => c.onDate)),
    [closures],
  );

  const [y0, m0] = todayKey.split("-").map(Number);
  const [year, setYear] = useState(y0);
  const [month, setMonth] = useState(m0 - 1); // 0-indexed
  const [selected, setSelected] = useState(todayKey);

  const firstOfMonth = new Date(Date.UTC(year, month, 1));
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const startWeekday = firstOfMonth.getUTCDay();
  const monthLabel = firstOfMonth.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

  const cells: (string | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(dayKeyOf(year, month, d));

  const goMonth = (delta: number) => {
    let m = month + delta;
    let y = year;
    if (m < 0) {
      m = 11;
      y -= 1;
    } else if (m > 11) {
      m = 0;
      y += 1;
    }
    setMonth(m);
    setYear(y);
  };

  const selectedBookings = grouped.get(selected) ?? [];
  const selectedLabel =
    selected === todayKey
      ? "Today"
      : new Date(`${selected}T00:00:00Z`).toLocaleDateString("en-US", {
          weekday: "long",
          day: "numeric",
          month: "short",
          timeZone: "UTC",
        });

  return (
    <>
      <h2 className="font-display text-[20px] font-bold tracking-tight">Calendar</h2>
      <p className="mt-0.5 text-[12px] font-medium text-muted">
        Everything on the books, by day — and where you close a date.
      </p>

      <div className="mt-5 grid gap-6 desk:grid-cols-[1fr_1fr] desk:items-start">
        <div>
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => goMonth(-1)}
              aria-label="Previous month"
              className="flex h-10 w-10 items-center justify-center rounded-[14px] border border-line bg-surface desk:h-9 desk:w-9 desk:rounded-lg"
            >
              <ChevronIcon size={14} className="rotate-180" />
            </button>
            <p className="text-[14px] font-bold">{monthLabel}</p>
            <button
              type="button"
              onClick={() => goMonth(1)}
              aria-label="Next month"
              className="flex h-10 w-10 items-center justify-center rounded-[14px] border border-line bg-surface desk:h-9 desk:w-9 desk:rounded-lg"
            >
              <ChevronIcon size={14} />
            </button>
          </div>

          <div className="mt-3 grid grid-cols-7 gap-1 text-center">
            {WEEKDAY_LABELS.map((w, i) => (
              <p key={i} className="text-[10.5px] font-bold text-muted">
                {w}
              </p>
            ))}
            {cells.map((key, i) => {
              if (!key) return <div key={i} />;
              const items = grouped.get(key) ?? [];
              const isClosed = closedDays.has(key);
              const isToday = key === todayKey;
              const isSelected = key === selected;
              const dayNum = Number(key.slice(-2));
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => setSelected(key)}
                  className={`flex h-11 flex-col items-center justify-center rounded-[14px] text-[12.5px] font-bold desk:h-14 desk:rounded-lg ${
                    isSelected
                      ? "bg-brand text-white"
                      : isClosed
                        ? "bg-sandsoft text-sandink2"
                        : isToday
                          ? "bg-brandsoft text-brand"
                          : "text-ink hover:bg-ground"
                  }`}
                >
                  {dayNum}
                  {(items.length > 0 || isClosed) && (
                    <span
                      className={`mt-0.5 h-1.5 w-1.5 rounded-full ${
                        isSelected ? "bg-white" : isClosed ? "bg-warn" : "bg-brand"
                      }`}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="border-t border-hairline pt-4 desk:border-t-0 desk:border-l desk:pt-0 desk:pl-6">
          <h3 className="text-[13.5px] font-bold">{selectedLabel}</h3>

          {selectedBookings.length === 0 ? (
            <p className="mt-3 text-[12.5px] font-medium text-muted">Nothing booked this day.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {selectedBookings.map((b) => {
                const Icon = KIND_ICON[b.kind];
                return (
                  <li className="flex items-center gap-3 rounded-[16px] border border-line bg-surface p-3.5 desk:rounded-xl desk:p-3" key={b.itemId}>
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-brandsoft text-brand desk:h-9 desk:w-9 desk:rounded-lg">
                      <Icon size={16} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-bold">{b.title}</p>
                      <p className="text-[11px] font-medium text-muted">
                        {KIND_LABEL[b.kind]} · {b.timeLabel}
                      </p>
                    </div>
                    <span className="shrink-0 text-[12px] font-bold text-ink">
                      {b.pricePaise === 0 ? "Free" : rupees(b.pricePaise)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          <DayAvailability
            dayKey={selected}
            isPast={selected < todayKey}
            canEdit={role === "owner"}
            closeable={closeable}
            closures={closures}
          />

          <Link href="/partner/bookings" className="mt-4 inline-flex items-center gap-1 text-[12px] font-bold text-brand">
            Open full Bookings list
            <ChevronIcon size={13} />
          </Link>
        </div>
      </div>
    </>
  );
}

type Editing = { type: "weather" } | { type: "listing"; key: string } | null;

function DayAvailability({
  dayKey,
  isPast,
  canEdit,
  closeable,
  closures,
}: {
  dayKey: string;
  isPast: boolean;
  canEdit: boolean;
  closeable: CloseableListing[];
  closures: PartnerClosure[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<Editing>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (closeable.length === 0) return null;

  const readOnly = isPast || !canEdit;
  // "Close the whole day — weather" only closes activities and trips.
  const hasWeatherKinds = closeable.some((l) => l.kind !== "rental");

  // "activity|<id>" -> reason, for this day only.
  const closedToday = new Map<string, string>(
    closures
      .filter((c) => c.onDate === dayKey)
      .map((c) => [`${c.kind}|${c.subjectId}`, c.reason]),
  );
  const allClosed = closeable.every((l) => closedToday.has(`${l.kind}|${l.id}`));

  const run = async (fn: () => Promise<{ ok: boolean; message: string }>) => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const result = await fn();
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    setEditing(null);
    setReason("");
    router.refresh();
  };

  const startEdit = (next: Editing) => {
    setEditing(next);
    setReason("");
    setProblem(null);
  };

  return (
    <div className="mt-5 border-t border-hairline pt-4">
      <h3 className="text-[13px] font-bold">Availability</h3>

      {readOnly ? (
        <p className="mt-2 text-[11.5px] font-medium text-muted">
          {isPast
            ? closedToday.size > 0
              ? "This date was closed."
              : "This date has passed — nothing to change."
            : "Only the owner can close a date."}
        </p>
      ) : hasWeatherKinds ? (
        <>
          {editing?.type === "weather" ? (
            <ReasonBox
              label="Close every activity and trip this day"
              reason={reason}
              setReason={setReason}
              busy={busy}
              onCancel={() => setEditing(null)}
              onConfirm={() => run(() => weatherClosePartner(dayKey, reason))}
            />
          ) : (
            !allClosed && (
              <button
                type="button"
                onClick={() => startEdit({ type: "weather" })}
                className="mt-2 flex h-9 items-center gap-1.5 rounded-lg bg-sandsoft px-3 text-[12px] font-bold text-sandink2"
              >
                <StormIcon size={14} />
                Close the whole day — weather
              </button>
            )
          )}
        </>
      ) : null}

      <ul className="mt-3 flex flex-col gap-2">
        {closeable.map((listing) => {
          const key = `${listing.kind}|${listing.id}`;
          const closedReason = closedToday.get(key) ?? null;
          const isEditingThis = editing?.type === "listing" && editing.key === key;

          return (
            <li key={key} className="rounded-[16px] border border-line bg-surface p-3.5 desk:rounded-xl desk:p-3">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] font-bold">{listing.title}</p>
                  <p className="text-[10.5px] font-semibold tracking-wide text-muted uppercase">
                    {listing.kind}
                  </p>
                </div>
                {closedReason !== null ? (
                  <span className="shrink-0 rounded-full bg-sandsoft px-2 py-1 text-[10px] font-bold text-warn">
                    Closed
                  </span>
                ) : (
                  <span className="shrink-0 rounded-full bg-brandsoft px-2 py-1 text-[10px] font-bold text-brand">
                    Open
                  </span>
                )}
              </div>

              {closedReason !== null && (
                <p className="mt-1.5 text-[11.5px] font-medium text-sandink2">{closedReason}</p>
              )}

              {!readOnly && (
                <div className="mt-2 border-t border-hairline pt-2">
                  {isEditingThis ? (
                    <ReasonBox
                      label={`Close ${listing.title} this day`}
                      reason={reason}
                      setReason={setReason}
                      busy={busy}
                      onCancel={() => setEditing(null)}
                      onConfirm={() =>
                        run(() => closePartnerDate(listing.kind, listing.id, dayKey, reason))
                      }
                    />
                  ) : closedReason !== null ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => run(() => reopenPartnerDate(listing.kind, listing.id, dayKey))}
                      className="h-8 rounded-lg border border-line bg-surface px-3 text-[11.5px] font-bold text-ink disabled:opacity-50"
                    >
                      {busy ? "…" : "Reopen"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => startEdit({ type: "listing", key })}
                      className="h-8 rounded-lg border border-line bg-surface px-3 text-[11.5px] font-bold text-ink"
                    >
                      Close this day
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {problem && <p className="mt-2 text-[11.5px] font-medium text-warn">{problem}</p>}
    </div>
  );
}

function ReasonBox({
  label,
  reason,
  setReason,
  busy,
  onCancel,
  onConfirm,
}: {
  label: string;
  reason: string;
  setReason: (v: string) => void;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="rounded-[14px] border border-line bg-ground p-3 desk:rounded-lg desk:p-2.5">
      <p className="text-[11px] font-bold text-muted">{label}</p>
      <input
        autoFocus
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Sea too rough for the crossing"
        className="mt-1.5 h-9 w-full rounded-lg border border-line bg-surface px-2.5 text-[12.5px] font-semibold outline-none focus:border-brand"
      />
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={busy || reason.trim() === ""}
          onClick={onConfirm}
          className="h-8 flex-1 rounded-lg bg-warn text-[11.5px] font-bold text-white disabled:bg-line disabled:text-muted"
        >
          {busy ? "Closing…" : "Close it"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="h-8 flex-1 rounded-lg border border-line bg-surface text-[11.5px] font-bold text-ink disabled:opacity-50"
        >
          Never mind
        </button>
      </div>
    </div>
  );
}
