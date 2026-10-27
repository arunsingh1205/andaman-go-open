"use client";

// The rate card only — dispatch itself (picking which operator's car takes
// a booking) lives on the Bookings page now, since a driver is a real
// partner account, not something this page manages.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { upsertCabRate, setCabRateActive, type AdminCabRate } from "@/lib/cab-rate-admin";
import { CATEGORY_LABEL, type CabCategory } from "@/lib/cabs";
import { RATE_TRIP_LABEL, type CabRateTripType } from "@/lib/cab-rate-card";
import type { CabPlace } from "@/lib/cabs";
import { ISLANDS } from "@/lib/islands";
import { PageHeader, Panel, RowHead, Row, Cell, EmptyState, Pill, rupees } from "../admin-ui";

const TRIP_TONE = { oneway: "live", roundtrip: "waiting", outstation: "down" } as const;

const inputClass =
  "h-10 rounded-xl border border-line bg-surface px-3 text-[13px] font-semibold outline-none focus:border-brand";
const labelClass = "flex flex-col gap-1.5 text-[12px] font-bold text-muted";

const CATEGORIES: CabCategory[] = ["hatchback", "sedan", "suv", "tempo"];
const TRIP_TYPES: CabRateTripType[] = ["oneway", "roundtrip", "outstation"];

export default function CabRatesView({
  rates,
  places,
}: {
  rates: AdminCabRate[];
  places: CabPlace[];
}) {
  return (
    <>
      <PageHeader
        title="Cab rate card"
        subtitle="The standardized fares travellers book against on the 'Book a ride' tab."
      />
      <RatesPanel rates={rates} places={places} />
    </>
  );
}

const RATE_COLS = "md:grid-cols-[1.6fr_1fr_1fr_100px_140px]";

function RatesPanel({ rates, places }: { rates: AdminCabRate[]; places: CabPlace[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<AdminCabRate | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const placeLabel = (id: string | null) => (id ? (places.find((p) => p.id === id)?.label ?? "—") : "Standard city zone");

  const togglePause = async (r: AdminCabRate) => {
    setBusyId(r.id);
    await setCabRateActive(r.id, !r.isActive);
    setBusyId(null);
    router.refresh();
  };

  return (
    <Panel title="Rate card">
      <RowHead cols={RATE_COLS}>
        <span>Fare</span>
        <span>Route</span>
        <span>Type</span>
        <span>Status</span>
        <span />
      </RowHead>

      {rates.length === 0 ? (
        <EmptyState>No fares yet — add the first one below.</EmptyState>
      ) : (
        rates.map((r) => (
          <Row key={r.id} cols={RATE_COLS}>
            <Cell label="Fare">
              <span className="block text-[13.5px] font-bold">{r.label}</span>
              <span className="block text-[11.5px] font-medium text-muted">
                {rupees(r.farePaise)} · {CATEGORY_LABEL[r.vehicleCategory]} ·{" "}
                {ISLANDS.find((i) => i.slug === r.islandSlug)?.name ?? r.islandSlug}
              </span>
            </Cell>
            <Cell label="Route">
              <span className="block text-[12px] font-semibold">
                {placeLabel(r.fromPlaceId)} → {placeLabel(r.toPlaceId)}
              </span>
            </Cell>
            <Cell label="Type">
              <Pill tone={TRIP_TONE[r.tripType]}>{RATE_TRIP_LABEL[r.tripType]}</Pill>
              {r.tripType === "outstation" && (
                <span className="block text-[11px] font-medium text-muted">{r.nights} night(s)</span>
              )}
            </Cell>
            <Cell label="Status">
              <span className={`text-[12px] font-bold ${r.isActive ? "text-brand" : "text-muted"}`}>
                {r.isActive ? "Live" : "Paused"}
              </span>
            </Cell>
            <Cell className="flex gap-2 md:justify-end">
              <button
                type="button"
                onClick={() => setEditing(r)}
                className="h-8 rounded-lg border border-line bg-surface px-3 text-[11.5px] font-bold text-ink"
              >
                Edit
              </button>
              <button
                type="button"
                disabled={busyId === r.id}
                onClick={() => togglePause(r)}
                className="h-8 rounded-lg border border-line bg-surface px-3 text-[11.5px] font-bold text-warn disabled:opacity-50"
              >
                {busyId === r.id ? "…" : r.isActive ? "Pause" : "Reactivate"}
              </button>
            </Cell>
          </Row>
        ))
      )}

      <div className="border-t border-hairline p-5">
        <RateForm key={editing?.id ?? "new"} editing={editing} places={places} onDone={() => setEditing(null)} />
      </div>
    </Panel>
  );
}

function RateForm({
  editing,
  places,
  onDone,
}: {
  editing: AdminCabRate | null;
  places: CabPlace[];
  onDone: () => void;
}) {
  const router = useRouter();
  const [label, setLabel] = useState(editing?.label ?? "");
  const [island, setIsland] = useState(editing?.islandSlug ?? ISLANDS[0].slug);
  const [tripType, setTripType] = useState<CabRateTripType>(editing?.tripType ?? "roundtrip");
  const [fromId, setFromId] = useState(editing?.fromPlaceId ?? "");
  const [toId, setToId] = useState(editing?.toPlaceId ?? "");
  const [category, setCategory] = useState<CabCategory>(editing?.vehicleCategory ?? "suv");
  const [rupeesFare, setRupeesFare] = useState(editing ? String(Math.round(editing.farePaise / 100)) : "");
  const [nights, setNights] = useState(String(editing?.nights ?? 0));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const islandPlaces = useMemo(
    () => places.filter((p) => p.island === (ISLANDS.find((i) => i.slug === island)?.name ?? "")),
    [places, island],
  );

  const submit = async () => {
    const fare = Math.round(Number(rupeesFare) * 100);
    if (!label.trim() || !Number.isFinite(fare) || fare <= 0) {
      setProblem("Give this fare a label and an amount greater than zero.");
      return;
    }
    setBusy(true);
    setProblem(null);
    const result = await upsertCabRate({
      id: editing?.id,
      islandSlug: island,
      label,
      tripType,
      fromPlaceId: fromId || null,
      toPlaceId: toId || null,
      vehicleCategory: category,
      farePaise: fare,
      nights: tripType === "outstation" ? Number(nights) || 0 : 0,
      sortOrder: editing?.sortOrder ?? 0,
      isActive: editing?.isActive ?? true,
    });
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    if (!editing) {
      setLabel("");
      setFromId("");
      setToId("");
      setRupeesFare("");
      setNights("0");
    }
    onDone();
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] font-bold tracking-wider text-muted uppercase">
        {editing ? `Editing "${editing.label}"` : "Add a fare"}
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className={labelClass}>
          Label (what the traveller sees)
          <input className={inputClass} value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <label className={labelClass}>
          Island
          <select className={inputClass} value={island} onChange={(e) => setIsland(e.target.value)}>
            {ISLANDS.map((i) => (
              <option key={i.slug} value={i.slug}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Trip type
          <select
            className={inputClass}
            value={tripType}
            onChange={(e) => setTripType(e.target.value as CabRateTripType)}
          >
            {TRIP_TYPES.map((t) => (
              <option key={t} value={t}>
                {RATE_TRIP_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Pickup <span className="font-medium normal-case">(blank = standard city zone)</span>
          <select className={inputClass} value={fromId} onChange={(e) => setFromId(e.target.value)}>
            <option value="">Standard city zone</option>
            {islandPlaces.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Destination <span className="font-medium normal-case">(blank = local hop only)</span>
          <select className={inputClass} value={toId} onChange={(e) => setToId(e.target.value)}>
            <option value="">No fixed destination</option>
            {islandPlaces.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Vehicle type
          <select
            className={inputClass}
            value={category}
            onChange={(e) => setCategory(e.target.value as CabCategory)}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Fare (₹)
          <input
            type="number"
            min="1"
            className={inputClass}
            value={rupeesFare}
            onChange={(e) => setRupeesFare(e.target.value)}
          />
        </label>
        {tripType === "outstation" && (
          <label className={labelClass}>
            Nights included
            <input
              type="number"
              min="0"
              className={inputClass}
              value={nights}
              onChange={(e) => setNights(e.target.value)}
            />
          </label>
        )}
      </div>
      {problem && <p className="text-[12px] font-bold text-warn">{problem}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={submit}
          className="h-10 rounded-xl bg-brand px-4 text-[12.5px] font-bold text-white disabled:bg-line disabled:text-muted"
        >
          {busy ? "Saving…" : editing ? "Save changes" : "Add fare"}
        </button>
        {editing && (
          <button
            type="button"
            onClick={onDone}
            className="h-10 rounded-xl border border-line bg-surface px-4 text-[12.5px] font-bold text-ink"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
