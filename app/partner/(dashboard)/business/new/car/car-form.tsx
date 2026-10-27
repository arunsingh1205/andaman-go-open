"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { addPartnerCar } from "@/lib/partner-cabs";
import { rupees } from "@/lib/activities";
import type { CabCategory, CabFuel } from "@/lib/cabs";
import PhotoGallery from "@/app/partner/(dashboard)/business/photo-gallery";
import { BackIcon } from "@/app/icons";

const CATEGORIES: { value: CabCategory; label: string }[] = [
  { value: "hatchback", label: "Hatchback" },
  { value: "sedan", label: "Sedan" },
  { value: "suv", label: "SUV" },
  { value: "tempo", label: "Tempo traveller" },
];

const FUELS: { value: CabFuel; label: string }[] = [
  { value: "petrol", label: "Petrol" },
  { value: "diesel", label: "Diesel" },
  { value: "ev", label: "Electric" },
];

const inputClass =
  "h-12 w-full min-w-0 rounded-xl border border-line bg-surface px-3.5 text-[15px] font-semibold outline-none focus:border-brand";
const labelText = "text-[12px] font-bold text-muted";

const toPaise = (s: string) => Math.round(parseFloat(s || "0") * 100);

export default function CarForm({
  partnerId,
  commissionBps,
  admin = false,
  backHref = "/partner/business",
}: {
  partnerId: string;
  /** Andaman Go's commission on cab bookings, in basis points (1500 = 15%). */
  commissionBps: number;
  /** An admin adding this for the business (136) — see activity-form.tsx. */
  admin?: boolean;
  backHref?: string;
}) {
  const commissionPct = Math.round(commissionBps / 100);
  const platformFee = (paise: number) => Math.round((paise * commissionBps) / 10000);
  const router = useRouter();
  const [category, setCategory] = useState<CabCategory>("sedan");
  const [model, setModel] = useState("");
  const [seats, setSeats] = useState("4");
  const [luggage, setLuggage] = useState("2");
  const [ac, setAc] = useState(true);
  const [fuel, setFuel] = useState<CabFuel>("petrol");
  const [boardNumber, setBoardNumber] = useState("");
  const [fullDay, setFullDay] = useState("");
  const [airport, setAirport] = useState("");
  const [night, setNight] = useState("");
  const [perKm, setPerKm] = useState("");
  const [perMin, setPerMin] = useState("");
  const [meta, setMeta] = useState("");
  const [photoPaths, setPhotoPaths] = useState<string[]>([]);
  const [busy, setBusy] = useState<"photo" | "submit" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const fullDayPaise = toPaise(fullDay);
  const canSubmit =
    model.trim() !== "" && fullDay.trim() !== "" && fullDayPaise >= 0 && !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy("submit");
    setProblem(null);

    const result = await addPartnerCar(
      {
        category,
        model,
        seats: parseInt(seats, 10) || 4,
        luggage: parseInt(luggage, 10) || 0,
        ac,
        fuel,
        boardNumber,
        fullDayPaise,
        airportSurchargePaise: toPaise(airport),
        nightSurchargePaise: toPaise(night),
        perKmPaise: toPaise(perKm),
        perMinPaise: toPaise(perMin),
        meta,
        photoPaths,
      },
      admin ? partnerId : undefined,
    );

    if (!result.ok) {
      setProblem(result.message);
      setBusy(null);
      return;
    }

    router.push(backHref);
  };

  return (
    <>
      <Link
        href={admin ? backHref : "/partner/business/new"}
        className="flex items-center gap-1.5 text-[13px] font-bold text-muted"
      >
        <BackIcon size={14} />
        {admin ? "Back" : "What are you adding?"}
      </Link>

      <h2 className="font-display mt-3 text-[20px] font-bold tracking-tight">Add a car</h2>
      <p className="mt-1 text-[12.5px] font-medium text-muted">
        Any yellow-board car is welcome. Set the per-route fares from the car&apos;s
        page once it&apos;s added. Andaman Go&apos;s commission on cab bookings is{" "}
        {commissionPct}%, collected online at checkout.
      </p>

      <div className="mt-5 flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Type</span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as CabCategory)}
            className={inputClass}
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Model</span>
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="Toyota Etios"
            className={inputClass}
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className={labelText}>Seats</span>
            <input
              type="number"
              inputMode="numeric"
              value={seats}
              onChange={(e) => setSeats(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelText}>Luggage bags</span>
            <input
              type="number"
              inputMode="numeric"
              value={luggage}
              onChange={(e) => setLuggage(e.target.value)}
              className={inputClass}
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className={labelText}>Fuel</span>
            <select
              value={fuel}
              onChange={(e) => setFuel(e.target.value as CabFuel)}
              className={inputClass}
            >
              {FUELS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            aria-pressed={ac}
            onClick={() => setAc(!ac)}
            className={`mt-[26px] flex h-12 items-center justify-center rounded-xl border text-[14px] font-bold ${
              ac ? "border-brand bg-brandsoft text-brand" : "border-line bg-surface text-muted"
            }`}
          >
            {ac ? "Air-conditioned" : "Non-AC"}
          </button>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Yellow-board number</span>
          <input
            value={boardNumber}
            onChange={(e) => setBoardNumber(e.target.value)}
            placeholder="AN-01-T-1234"
            className={inputClass}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Full-day fare (₹ per day)</span>
          <input
            type="number"
            inputMode="decimal"
            value={fullDay}
            onChange={(e) => setFullDay(e.target.value)}
            placeholder="3500"
            className={inputClass}
          />
          {fullDayPaise > 0 && (
            <span className="text-[11px] font-medium text-muted">
              Traveller pays {rupees(fullDayPaise)}/day · {commissionPct}% platform fee{" "}
              {rupees(platformFee(fullDayPaise))} · you receive{" "}
              {rupees(fullDayPaise - platformFee(fullDayPaise))}/day
            </span>
          )}
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className={labelText}>Airport surcharge (₹)</span>
            <input
              type="number"
              inputMode="decimal"
              value={airport}
              onChange={(e) => setAirport(e.target.value)}
              placeholder="0"
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelText}>Night charge (₹)</span>
            <input
              type="number"
              inputMode="decimal"
              value={night}
              onChange={(e) => setNight(e.target.value)}
              placeholder="0"
              className={inputClass}
            />
          </label>
        </div>
        <p className="-mt-1 text-[11px] font-medium text-muted">
          Added automatically to any airport trip, and to pickups between 10 PM and 6 AM.
          Leave blank for none.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className={labelText}>Your ₹/km (optional)</span>
            <input
              type="number"
              inputMode="decimal"
              value={perKm}
              onChange={(e) => setPerKm(e.target.value)}
              placeholder="18"
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelText}>Your ₹/min (optional)</span>
            <input
              type="number"
              inputMode="decimal"
              value={perMin}
              onChange={(e) => setPerMin(e.target.value)}
              placeholder="2"
              className={inputClass}
            />
          </label>
        </div>
        <p className="-mt-1 text-[11px] font-medium text-muted">
          Only used to help you work out route fares later — never charged directly.
        </p>

        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Anything a traveller should know (optional)</span>
          <input
            value={meta}
            onChange={(e) => setMeta(e.target.value)}
            placeholder="Experienced driver, child seat on request"
            className={inputClass}
          />
        </label>

        <PhotoGallery
          partnerId={partnerId}
          value={photoPaths}
          onChange={setPhotoPaths}
          onBusyChange={(b) => setBusy(b ? "photo" : null)}
        />

        {problem && <p className="text-[12.5px] font-medium text-warn">{problem}</p>}

        <button
          type="button"
          disabled={!canSubmit}
          onClick={submit}
          className="mt-2 h-14 w-full rounded-2xl bg-brand text-[15px] font-bold text-white disabled:bg-line disabled:text-muted"
        >
          {busy === "submit" ? "Adding…" : "Submit for review"}
        </button>
      </div>
    </>
  );
}
