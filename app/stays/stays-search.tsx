"use client";

// The Stays landing page — a destination search, not a straight-to-list
// page. Deliberately does NOT read the app's shared "current island" cookie
// (lib/current-island.ts) the way Activities/Cabs do: that layer is meant
// for a traveller already on one island browsing same-island things, and
// silently reusing it here caused real confusion — a partner's listing
// island and a traveller's last-viewed island are two different facts, and
// conflating them risks a listing looking like it's on the wrong island (or
// a partner registering it there by mistake). So the destination is asked
// for here, explicitly, every time — the same shape a hotel search on any
// major booking site starts with.
//
// Split out of page.tsx because useSearchParams() below forces whatever
// renders it to bail out to client rendering, and Next needs a <Suspense>
// boundary above it to contain that bailout — page.tsx is now that boundary,
// and serves a prerendered shell of this same screen while it hydrates. This
// used to build fine only by accident: the root layout called cookies(),
// which made every route dynamic, so this was never prerendered and the
// missing boundary never surfaced.

import { useRef, useState, type RefObject } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ISLANDS } from "@/lib/islands";
import { addDays, dayKey, todayIST } from "@/lib/date";
import { BedIcon, CalendarIcon, ChevronIcon } from "@/app/icons";
import BottomNav from "@/app/bottom-nav";
import PageBack from "@/app/page-back";

const inputClass =
  "h-12 w-full rounded-xl border border-line bg-surface px-3.5 text-[14px] font-semibold text-ink outline-none focus:border-brand";
const labelText = "text-[11.5px] font-bold text-muted";

// Three fixes at the CSS layout level (grid-cols-2, then a wrapping flex row,
// then a full-width single column) all failed to stop Check-in/Check-out
// overflowing the card, because none of them were the actual cause: a native
// <input type="date"> renders its value ("26 Sep 2026") and calendar icon at
// a fixed internal content width the browser won't shrink below, no matter
// what CSS width/min-width says — the overflow happens inside the control's
// own rendering, not in the box around it. Formatting the date ourselves
// only helps in the sense that OUR text can shrink or truncate; it doesn't
// touch what the native control itself would render.
//
// So this doesn't render a visible <input type="date"> at all. Each field is
// a plain button showing our own formatted text (full width control, same as
// every other control on this card), sitting over an invisible real
// input[type=date] that still holds the actual value and still opens the
// device's native date picker — just via showPicker() from the button's tap
// instead of the input rendering its own (oversized) UI.
function fmtShortDate(dayKeyValue: string): string {
  return new Date(`${dayKeyValue}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function openDatePicker(ref: RefObject<HTMLInputElement | null>) {
  const el = ref.current;
  if (!el) return;
  if (typeof el.showPicker === "function") el.showPicker();
  else el.focus();
}

export default function StaysSearch() {
  const router = useRouter();
  const existing = useSearchParams();
  const minCheckIn = dayKey(addDays(todayIST(), 1));

  // Tapping the summary bar on the results page (or its search icon) lands
  // back here with the same search in the URL, so editing it doesn't mean
  // starting over from scratch.
  const [island, setIsland] = useState(existing.get("island") ?? ""); // "" = any island
  const [checkIn, setCheckIn] = useState(existing.get("checkin") ?? minCheckIn);
  const [checkOut, setCheckOut] = useState(
    existing.get("checkout") ?? dayKey(addDays(todayIST(), 3)),
  );
  const [guests, setGuests] = useState(() => {
    const n = Number(existing.get("guests"));
    return Number.isFinite(n) && n >= 1 ? n : 2;
  });
  const checkInRef = useRef<HTMLInputElement>(null);
  const checkOutRef = useRef<HTMLInputElement>(null);

  // Check-out's min={checkIn} only stops the picker offering an invalid date
  // going forward — it doesn't touch a check-out value picked earlier that
  // checkIn has now moved past. Left alone, the field kept showing that
  // stale date after every check-in change, which read as "check-out isn't
  // updating." Push it forward the same way check-in itself moved (a step
  // later than the new check-in), only when it's actually now invalid.
  const handleCheckIn = (value: string) => {
    setCheckIn(value);
    setCheckOut((prev) => (prev <= value ? dayKey(addDays(new Date(`${value}T00:00:00Z`), 2)) : prev));
  };

  const search = () => {
    const q = new URLSearchParams();
    if (island) q.set("island", island);
    q.set("checkin", checkIn);
    q.set("checkout", checkOut);
    q.set("guests", String(guests));
    router.push(`/stays/results?${q.toString()}`);
  };

  return (
    <>
      <div className="sticky top-0 z-30 bg-brand text-white">
        <div className="page-flow pt-[calc(var(--safe-top)+1.5rem)] pb-5">
          <div className="flex items-center gap-3">
            <PageBack href="/explore" />
            <h1 className="font-display text-[19px] lg:text-page font-bold tracking-tight">Stays & homestays</h1>
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-[12.5px] font-medium text-white/85">
            <BedIcon size={14} className="shrink-0" />
            Rooms and whole properties, booked directly with the host
          </p>
        </div>
      </div>

      {/* pt-4, not a negative margin up into the teal band: the band is sticky
          at z-30, so a card pulled up under it didn't overlap it — its top
          edge and rounded corners were simply hidden behind the band. */}
      <main className="page-flow pt-4 pb-32">
        <div className="rounded-[20px] border border-line bg-surface p-5 shadow-[0_6px_24px_rgba(11,36,34,0.08)]">
          <label className="flex flex-col gap-1.5">
            <span className={labelText}>Where are you going?</span>
            <select value={island} onChange={(e) => setIsland(e.target.value)} className={inputClass}>
              <option value="">Any island</option>
              {ISLANDS.map((isl) => (
                <option key={isl.slug} value={isl.slug}>
                  {isl.name}
                </option>
              ))}
            </select>
          </label>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="relative flex min-w-0 flex-col gap-1.5">
              <span className={labelText}>Check-in</span>
              <button
                type="button"
                aria-label="Check-in date"
                onClick={() => openDatePicker(checkInRef)}
                className={`${inputClass} flex items-center justify-between gap-2 text-left`}
              >
                <span className="truncate">{fmtShortDate(checkIn)}</span>
                <CalendarIcon size={16} className="shrink-0 text-muted" />
              </button>
              <input
                ref={checkInRef}
                type="date"
                min={minCheckIn}
                value={checkIn}
                onChange={(e) => handleCheckIn(e.target.value)}
                aria-hidden="true"
                tabIndex={-1}
                className="absolute h-0 w-0 opacity-0"
              />
            </div>
            <div className="relative flex min-w-0 flex-col gap-1.5">
              <span className={labelText}>Check-out</span>
              <button
                type="button"
                aria-label="Check-out date"
                onClick={() => openDatePicker(checkOutRef)}
                className={`${inputClass} flex items-center justify-between gap-2 text-left`}
              >
                <span className="truncate">{fmtShortDate(checkOut)}</span>
                <CalendarIcon size={16} className="shrink-0 text-muted" />
              </button>
              <input
                ref={checkOutRef}
                type="date"
                min={checkIn}
                value={checkOut}
                onChange={(e) => setCheckOut(e.target.value)}
                aria-hidden="true"
                tabIndex={-1}
                className="absolute h-0 w-0 opacity-0"
              />
            </div>
          </div>

          <label className="mt-3 flex flex-col gap-1.5">
            <span className={labelText}>Guests</span>
            <div className="flex h-12 items-center justify-between rounded-xl border border-line bg-surface px-3.5">
              <span className="text-[14px] font-semibold">
                {guests} {guests === 1 ? "guest" : "guests"}
              </span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  aria-label="Fewer guests"
                  onClick={() => setGuests((g) => Math.max(1, g - 1))}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-lg font-bold text-brand"
                >
                  −
                </button>
                <button
                  type="button"
                  aria-label="More guests"
                  onClick={() => setGuests((g) => Math.min(30, g + 1))}
                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-lg font-bold text-white"
                >
                  +
                </button>
              </div>
            </div>
          </label>

          <button
            type="button"
            onClick={search}
            className="mt-4 flex h-13 w-full items-center justify-center gap-2 rounded-2xl bg-brand text-[15px] font-bold text-white"
          >
            Search stays
            <ChevronIcon size={18} />
          </button>
        </div>
      </main>

      <BottomNav />
    </>
  );
}
