"use client";

// Book against the standardized rate card (077/078), not a specific car.
// Deliberately simpler than CabSearch: there's one fare per destination, so
// there's nothing to compare — pick where you're going, pick when, pay. The
// driver is somebody Andaman Go finds afterwards, which is the one thing
// this screen has to say plainly rather than imply.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { rupees } from "@/lib/activities";
import { addDays, dayKey, fmtDateLabel, fmtClock, instantIso, todayIST } from "@/lib/date";
import { ensureSession } from "@/lib/supabase-browser";
import { bookRateCardCab } from "@/lib/cab-ratecard-book";
import { currentPosition } from "@/lib/geolocation";
import { reverseGeocode } from "@/lib/reverse-geocode";
import { chargeViaRazorpay, makeReceipt } from "@/lib/razorpay-client";
import { CATEGORY_LABEL, cabPaymentSplit, type CabCategory, type CabPayMode, type CabPlace } from "@/lib/cabs";
import { RATE_TRIP_LABEL, rateCardFare, type CabRate } from "@/lib/cab-rate-card";
import { CheckIcon, ChevronIcon, PinIcon } from "@/app/icons";
import PlacePicker, { type PickerPlace } from "@/app/place-picker";

const CATEGORY_ORDER: CabCategory[] = ["sedan", "suv", "hatchback", "tempo"];

const DAY_START_HOUR = 5;
const DAY_END_HOUR = 22;
const PICKUP_TIMES = Array.from(
  { length: DAY_END_HOUR - DAY_START_HOUR + 1 },
  (_, i) => (DAY_START_HOUR + i) * 60,
);

/** The pure local hop has no real cab_places row (both ends are "wherever in
 *  the city") — this stands in for it in the destination picker below. */
const LOCAL_HOP_ID = "local-hop";

/** One row per distinct destination on the card — the thing a traveller
 *  actually picks. "Standard" pickup-zone rows (fromPlaceId null) lead; a
 *  destination with zone-specific variants (Corbyn's Cove) offers a second
 *  picker once chosen. The pure local hop (both ids null) is its own entry. */
function destinations(rates: CabRate[]): CabRate[] {
  const seen = new Set<string>();
  const out: CabRate[] = [];
  for (const r of rates) {
    const key = r.toPlaceId ?? "local";
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/** Destinations as the same Google-Maps-style typeahead the marketplace tab
 *  uses (app/place-picker.tsx) — the real cab_places row for a named
 *  destination, or a synthetic entry for the local hop, which isn't one. */
function destinationPickerPlaces(dests: CabRate[], places: CabPlace[]): PickerPlace[] {
  return dests.map((d) => {
    if (d.toPlaceId === null) {
      return {
        id: LOCAL_HOP_ID,
        label: d.label,
        island: "",
        isAirport: false,
        aliases: ["point to point", "local", "within city", "city hop", "nearby"],
      };
    }
    const place = places.find((p) => p.id === d.toPlaceId);
    return {
      id: d.toPlaceId,
      label: place?.label ?? d.label,
      island: place?.island ?? "",
      isAirport: place?.isAirport ?? false,
      aliases: place?.aliases ?? [],
    };
  });
}

export default function RateCardSearch({
  islandSlug,
  places,
  rates,
  commissionBps,
  initialPhone,
}: {
  islandSlug: string;
  places: CabPlace[];
  rates: CabRate[];
  commissionBps: number;
  /** The number already on file, if any — pre-fills the phone field so a
   *  returning traveller doesn't retype it every time. */
  initialPhone: string | null;
}) {
  const router = useRouter();

  // Only offer a tier the rate card actually has data for — sedan and suv
  // today, hatchback/tempo once (if) admin adds fares for them (087).
  // Sedan leads: it's the newer, more complete official list.
  const availableCategories = useMemo(() => {
    const present = new Set(rates.map((r) => r.vehicleCategory));
    return CATEGORY_ORDER.filter((c) => present.has(c));
  }, [rates]);
  const [vehicleCategory, setVehicleCategory] = useState<CabCategory>(
    () => availableCategories[0] ?? "suv",
  );

  // Every destination lookup below is scoped to the selected tier — the two
  // tiers don't necessarily cover the exact same set of places.
  const categoryRates = useMemo(
    () => rates.filter((r) => r.vehicleCategory === vehicleCategory),
    [rates, vehicleCategory],
  );
  const dests = useMemo(() => destinations(categoryRates), [categoryRates]);
  const destinationPlaces = useMemo(() => destinationPickerPlaces(dests, places), [dests, places]);
  const [destId, setDestId] = useState<string | null>(() => destinationPlaces[0]?.id ?? null);
  const toId = destId === LOCAL_HOP_ID ? null : destId;

  const changeCategory = (cat: CabCategory) => {
    if (cat === vehicleCategory) return;
    const newDests = destinations(rates.filter((r) => r.vehicleCategory === cat));
    const stillOffered = newDests.some((d) => d.toPlaceId === toId);
    setVehicleCategory(cat);
    setFromId(null);
    if (!stillOffered) {
      const first = newDests[0];
      setDestId(first ? (first.toPlaceId ?? LOCAL_HOP_ID) : null);
    }
  };

  // Which specific pickup-zone rows exist for the chosen destination, beyond
  // the standard (fromPlaceId null) one — e.g. Corbyn's Cove from Dollygunj
  // or Garacharma costs more than from the city.
  const zoneRows = useMemo(
    () => categoryRates.filter((r) => r.toPlaceId === toId && r.fromPlaceId !== null),
    [categoryRates, toId],
  );
  const [fromId, setFromId] = useState<string | null>(null);

  const match = useMemo(
    () =>
      rateCardFare(rates, {
        tripType:
          categoryRates.find((r) => r.toPlaceId === toId && r.fromPlaceId === fromId)?.tripType ??
          categoryRates.find((r) => r.toPlaceId === toId)?.tripType ??
          "roundtrip",
        fromPlaceId: fromId,
        toPlaceId: toId,
        vehicleCategory,
      }),
    [rates, categoryRates, toId, fromId, vehicleCategory],
  );

  const firstDay = useMemo(() => addDays(todayIST(), 1), []);
  const dayChips = useMemo(() => Array.from({ length: 14 }, (_, i) => addDays(firstDay, i)), [firstDay]);
  const [pickDateKey, setPickDateKey] = useState(dayKey(firstDay));
  const [pickupMins, setPickupMins] = useState(9 * 60);
  const [payMode, setPayMode] = useState<CabPayMode>("partial");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // lib/geolocation.ts — a real native OS permission in the app, the
  // browser's own on plain web; no Google Maps API involved either way.
  // Purely additive: the named pickup above already carries the fare, this
  // just gets a driver to the exact gate.
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [pinLabel, setPinLabel] = useState<string | null>(null);
  const [namingPin, setNamingPin] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);

  // What the traveller actually is — a hotel/resort/landmark name, typed by
  // hand. This is the part a driver can act on with no signal at all; the
  // pin above is a bonus once they're close.
  const [address, setAddress] = useState("");
  const [addressError, setAddressError] = useState(false);

  // Who to actually call. Unlike every other booking kind, a cab needs this
  // before the trip, not after — dispatch is on the phone with someone,
  // possibly today (088).
  const [travellerName, setTravellerName] = useState("");
  const [nameError, setNameError] = useState(false);
  const [travellerPhone, setTravellerPhone] = useState(initialPhone ?? "");
  const [phoneError, setPhoneError] = useState(false);

  const shareLocation = () => {
    setLocating(true);
    setLocError(null);
    currentPosition({ enableHighAccuracy: true }).then((pos) => {
      if (!pos) {
        setLocError("Couldn't get your location — check location permission and try again.");
        setLocating(false);
        return;
      }
      const next = { lat: pos.latitude, lng: pos.longitude };
      setPin(next);
      setLocating(false);
      // Best-effort naming — a slow or unreachable lookup still leaves the
      // pin itself captured, just without a friendly label on screen.
      setNamingPin(true);
      reverseGeocode(next.lat, next.lng)
        .then(setPinLabel)
        .finally(() => setNamingPin(false));
    });
  };

  const placeLabel = (id: string | null) => places.find((p) => p.id === id)?.label ?? "—";

  // The address the traveller typed and any extra note both end up in the
  // one free-text pickup_note column — there's nothing structural to keep
  // them apart, and a driver reads them as one line either way.
  const fullPickupNote = [address.trim(), note.trim()].filter(Boolean).join(" — ");

  const addressReady = address.trim().length > 0;
  const nameReady = travellerName.trim().length > 0;
  const phoneReady = travellerPhone.replace(/[^0-9]/g, "").length >= 10;

  const submit = async () => {
    if (!match || busy) return;
    if (!nameReady || !phoneReady || !addressReady) {
      setNameError(!nameReady);
      setPhoneError(!phoneReady);
      setAddressError(!addressReady);
      setProblem(
        !nameReady
          ? "Add your name so a driver knows who they're picking up."
          : !phoneReady
            ? "Add a working phone number — dispatch calls to confirm the pickup."
            : "Add your hotel, resort, or landmark name so a driver can find you.",
      );
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await ensureSession();
      const split = cabPaymentSplit(match.farePaise, payMode, commissionBps);
      const razorpay = await chargeViaRazorpay({
        amountPaise: split.paidNowPaise,
        receipt: makeReceipt(`cabrc-${islandSlug}`),
        description: match.label,
      });

      const result = await bookRateCardCab({
        islandSlug,
        tripType: match.tripType,
        vehicleCategory,
        fromPlaceId: fromId,
        toPlaceId: toId,
        startsAt: instantIso(pickDateKey, pickupMins),
        travellerName: travellerName.trim(),
        travellerPhone: travellerPhone.trim(),
        pickupNote: fullPickupNote,
        pickupLat: pin?.lat ?? null,
        pickupLng: pin?.lng ?? null,
        payMode,
        razorpay,
      });
      if (!result.ok) {
        setProblem(result.message);
        setBusy(false);
        return;
      }

      const q = new URLSearchParams({
        type: "cabrc",
        id: islandSlug,
        tt: match.tripType,
        cat: vehicleCategory,
        pd: pickDateKey,
        pt: String(pickupMins),
        pay: payMode,
        ref: result.ref,
      });
      if (fromId) q.set("from", fromId);
      if (toId) q.set("to", toId);
      router.push(`/booked?${q.toString()}`);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Something went wrong.");
      setBusy(false);
    }
  };

  if (dests.length === 0) {
    return (
      <main className="page-flow pt-10 pb-16 text-center">
        <p className="text-[13.5px] font-medium text-muted">
          The rate card for this island isn&apos;t set up yet.
        </p>
      </main>
    );
  }

  const total = match?.farePaise ?? 0;
  const split = cabPaymentSplit(total, payMode, commissionBps);

  return (
    <main className="page-flow pt-4 pb-40">
      {availableCategories.length > 1 && (
        <div className="mb-4">
          <p className="text-[11px] font-bold tracking-wider text-muted uppercase">Vehicle</p>
          <div className="mt-2 flex gap-2">
            {availableCategories.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={vehicleCategory === c}
                onClick={() => changeCategory(c)}
                className={`h-10 flex-1 rounded-xl text-[13px] font-bold ${
                  vehicleCategory === c
                    ? "bg-brand text-white"
                    : "border border-line bg-surface text-ink"
                }`}
              >
                {CATEGORY_LABEL[c]}
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="text-[11px] font-bold tracking-wider text-muted uppercase">Where are we taking you?</p>
      <div className="mt-2">
        <PlacePicker
          places={destinationPlaces}
          value={destId}
          onChange={(id) => {
            setDestId(id);
            setFromId(null);
          }}
          placeholder="Search a destination"
        />
      </div>

      {match && <TripTypeBadge tripType={match.tripType} className="mt-2.5" />}

      {zoneRows.length > 0 && (
        <div className="mt-3">
          <p className="text-[11px] font-bold tracking-wider text-muted uppercase">Pickup zone</p>
          <div className="mt-2 flex flex-col gap-1.5">
            <ZoneOption
              on={fromId === null}
              onClick={() => setFromId(null)}
              label="Standard city pickup"
              fare={categoryRates.find((r) => r.toPlaceId === toId && r.fromPlaceId === null)?.farePaise}
            />
            {zoneRows.map((r) => (
              <ZoneOption
                key={r.id}
                on={fromId === r.fromPlaceId}
                onClick={() => setFromId(r.fromPlaceId)}
                label={placeLabel(r.fromPlaceId)}
                fare={r.farePaise}
              />
            ))}
          </div>
        </div>
      )}

      <div className="mt-4">
        <p className="text-[11px] font-bold tracking-wider text-muted uppercase">Pickup date</p>
        <div className="no-bar mt-2 flex gap-2 overflow-x-auto pb-1 lg:flex-wrap lg:overflow-visible">
          {dayChips.map((d) => {
            const key = dayKey(d);
            const on = key === pickDateKey;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={on}
                onClick={() => setPickDateKey(key)}
                className={`flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-xl text-[12px] font-bold ${
                  on ? "bg-brand text-white" : "border border-line bg-surface text-ink"
                }`}
              >
                <span className={on ? "text-white/80" : "text-muted"}>
                  {d.toLocaleDateString("en-IN", { weekday: "short", timeZone: "Asia/Kolkata" })}
                </span>
                {d.toLocaleDateString("en-IN", { day: "numeric", timeZone: "Asia/Kolkata" })}
              </button>
            );
          })}
        </div>
      </div>

      <label className="mt-4 flex flex-col gap-1.5">
        <span className="text-[11px] font-bold tracking-wider text-muted uppercase">Pickup time</span>
        <select
          value={pickupMins}
          onChange={(e) => setPickupMins(Number(e.target.value))}
          className="h-11 rounded-xl border border-line bg-surface px-3.5 text-[14px] font-semibold outline-none focus:border-brand"
        >
          {PICKUP_TIMES.map((m) => (
            <option key={m} value={m}>
              {fmtClock(m)}
            </option>
          ))}
        </select>
      </label>

      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-bold tracking-wider text-muted uppercase">Your name</span>
          <input
            type="text"
            required
            autoComplete="name"
            value={travellerName}
            onChange={(e) => {
              setTravellerName(e.target.value);
              if (nameError) {
                setNameError(false);
                setProblem(null);
              }
            }}
            placeholder="Full name"
            className={`h-11 rounded-xl border bg-surface px-3.5 text-[14px] font-medium outline-none focus:border-brand ${
              nameError ? "border-warn" : "border-line"
            }`}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-bold tracking-wider text-muted uppercase">Your phone</span>
          <input
            type="tel"
            inputMode="numeric"
            required
            autoComplete="tel"
            value={travellerPhone}
            onChange={(e) => {
              setTravellerPhone(e.target.value);
              if (phoneError) {
                setPhoneError(false);
                setProblem(null);
              }
            }}
            placeholder="98765 43210"
            className={`h-11 rounded-xl border bg-surface px-3.5 text-[14px] font-medium outline-none focus:border-brand ${
              phoneError ? "border-warn" : "border-line"
            }`}
          />
        </label>
      </div>
      <p className="mt-1.5 text-[11.5px] font-medium text-muted">
        Dispatch calls this number to confirm your pickup — required for every cab booking.
      </p>

      <label className="mt-4 flex flex-col gap-1.5">
        <span className="text-[11px] font-bold tracking-wider text-muted uppercase">
          Where exactly are you?
        </span>
        <input
          type="text"
          required
          value={address}
          onChange={(e) => {
            setAddress(e.target.value);
            if (addressError) {
              setAddressError(false);
              setProblem(null);
            }
          }}
          placeholder="Hotel, resort, or landmark name"
          className={`h-11 rounded-xl border bg-surface px-3.5 text-[14px] font-medium outline-none focus:border-brand ${
            addressError ? "border-warn" : "border-line"
          }`}
        />
      </label>

      <div className="mt-4">
        <p className="text-[11px] font-bold tracking-wider text-muted uppercase">
          Exact pickup pin <span className="font-medium normal-case">(optional)</span>
        </p>
        {pin ? (
          <div className="mt-2 flex items-center justify-between gap-3 rounded-xl border border-brand bg-brandsoft px-3.5 py-2.5">
            <span className="flex min-w-0 items-center gap-2 text-[13px] font-bold text-brand">
              <PinIcon size={15} className="shrink-0" />
              <span className="truncate">
                {namingPin ? "Finding the name…" : (pinLabel ?? "Pinned")}
              </span>
            </span>
            <button
              type="button"
              onClick={() => {
                setPin(null);
                setPinLabel(null);
                setNamingPin(false);
              }}
              className="shrink-0 text-[12px] font-bold text-muted"
            >
              Remove
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={shareLocation}
            disabled={locating}
            className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-line bg-surface text-[13px] font-bold text-brand disabled:opacity-60"
          >
            <PinIcon size={15} />
            {locating ? "Getting your location…" : "Share my exact location"}
          </button>
        )}
        <p className="mt-1.5 text-[11.5px] font-medium text-muted">
          Drops your GPS position for the driver, on top of the address above — useful once
          they&apos;re close and need the exact gate.
        </p>
        {locError && <p className="mt-1.5 text-[11.5px] font-semibold text-warn">{locError}</p>}
      </div>

      {match && (
        <>
          <div className="mt-5 flex flex-col gap-2 rounded-[18px] border border-line bg-surface p-4 text-[13.5px]">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold tracking-wider text-muted uppercase">
                Trip type
              </span>
              <TripTypeBadge tripType={match.tripType} />
            </div>
            <Line
              label="Route"
              value={
                match.tripType === "outstation"
                  ? `${placeLabel(toId)} · ${match.nights + 1} day${match.nights + 1 === 1 ? "" : "s"}`
                  : `${fromId ? placeLabel(fromId) : "Standard city pickup"} → ${
                      toId ? placeLabel(toId) : "Local hop"
                    }`
              }
            />
            <Line label="Pickup" value={`${fmtDateLabel(new Date(`${pickDateKey}T00:00:00Z`))}, ${fmtClock(pickupMins)}`} />
            <div className="mt-1 flex justify-between border-t border-hairline pt-2 text-[16px] font-bold">
              <span>Total fare</span>
              <span>{rupees(total)}</span>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-2">
            <PayOption
              on={payMode === "partial"}
              onClick={() => setPayMode("partial")}
              title={`Pay ${rupees(cabPaymentSplit(total, "partial", commissionBps).paidNowPaise)} now`}
              sub={`${rupees(cabPaymentSplit(total, "partial", commissionBps).balancePaise)} to the driver on the day`}
            />
            <PayOption
              on={payMode === "full"}
              onClick={() => setPayMode("full")}
              title={`Pay ${rupees(total)} now`}
              sub="Nothing to pay the driver"
            />
          </div>

          <p className="mt-2 text-[11.5px] font-medium text-muted">
            A driver from our roster is assigned after you book — you&apos;ll see their name and
            number here and in My bookings shortly.
          </p>

          <label className="mt-4 flex flex-col gap-1.5">
            <span className="text-[12px] font-bold text-muted">
              Anything the driver should know (optional)
            </span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Flight number, extra luggage, anything else…"
              className="rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[14px] font-medium outline-none focus:border-brand"
            />
          </label>

          {problem && (
            <p className="mt-3 rounded-xl border border-sandline bg-sandsoft px-3.5 py-2.5 text-[12.5px] leading-relaxed font-medium text-sandink2">
              {problem}
            </p>
          )}

          <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface">
            <div className="page-flow flex items-center gap-3.5 pt-3.5 pb-[max(1.5rem,calc(var(--safe-bottom)+0.5rem))]">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-semibold text-muted">Pay now</p>
                <p className="mt-0.5 text-[19px] font-bold tracking-tight">{rupees(split.paidNowPaise)}</p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={submit}
                className="flex h-13 shrink-0 items-center gap-2 rounded-2xl bg-brand px-6 py-3.5 text-[15px] font-bold text-white disabled:opacity-60"
              >
                {busy ? "Booking…" : "Pay & book"}
                <ChevronIcon size={18} />
              </button>
            </div>
          </div>
        </>
      )}
    </main>
  );
}

/**
 * A one-way fare and a round-trip fare are easy to mix up on a rate card —
 * this is the one thing Arun asked to always be obvious, so it's a coloured
 * badge everywhere the trip type shows, not just text in a list of facts.
 */
function TripTypeBadge({ tripType, className = "" }: { tripType: CabRate["tripType"]; className?: string }) {
  const tone =
    tripType === "oneway"
      ? "bg-brandsoft text-brand"
      : tripType === "outstation"
        ? "bg-[#FBE7DC] text-warn"
        : "bg-sandsoft text-sandink2";
  return (
    <span
      className={`inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1 text-[11.5px] font-bold tracking-wide uppercase ${tone} ${className}`}
    >
      {tripType === "oneway" && "↗\uFE0E"}
      {tripType === "roundtrip" && "↔\uFE0E"}
      {tripType === "outstation" && "⏱\uFE0E"}
      {RATE_TRIP_LABEL[tripType]}
    </span>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="font-medium text-muted">{label}</span>
      <span className="text-right font-semibold">{value}</span>
    </div>
  );
}

function PayOption({
  on,
  onClick,
  title,
  sub,
}: {
  on: boolean;
  onClick: () => void;
  title: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`flex items-center gap-3 rounded-2xl border px-3.5 py-3 text-left ${
        on ? "border-brand bg-brandsoft" : "border-line bg-surface"
      }`}
    >
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
          on ? "border-brand bg-brand text-white" : "border-line"
        }`}
      >
        {on && <CheckIcon size={13} />}
      </span>
      <span className="min-w-0">
        <span className="block text-[13.5px] font-bold">{title}</span>
        <span className="block text-[11.5px] font-medium text-muted">{sub}</span>
      </span>
    </button>
  );
}

function ZoneOption({
  on,
  onClick,
  label,
  fare,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  fare?: number;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-left ${
        on ? "border-brand bg-brandsoft" : "border-line bg-surface"
      }`}
    >
      <span className="flex items-center gap-2 text-[13px] font-semibold">
        <PinIcon size={14} className={on ? "text-brand" : "text-muted"} />
        {label}
      </span>
      {fare !== undefined && <span className="text-[12.5px] font-bold">{rupees(fare)}</span>}
    </button>
  );
}
