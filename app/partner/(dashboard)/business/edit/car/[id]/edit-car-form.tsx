"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  updatePartnerCar,
  setCarRoutes,
  type CarDetail,
  type CarRouteInput,
} from "@/lib/partner-cabs";
import { adminSetCarRoutes, adminUpdateCar } from "@/lib/admin-listing-edit";
import { rupees } from "@/lib/activities";
import {
  CATEGORY_LABEL,
  FUEL_LABEL,
  type CabCategory,
  type CabFuel,
  type CabPlace,
} from "@/lib/cabs";
import PhotoGallery from "@/app/partner/(dashboard)/business/photo-gallery";
import PlacePicker from "@/app/place-picker";
import { BackIcon, CheckIcon, CloseIcon, PlusIcon } from "@/app/icons";

const CATEGORIES = Object.keys(CATEGORY_LABEL) as CabCategory[];
const FUELS = Object.keys(FUEL_LABEL) as CabFuel[];

const inputClass =
  "h-12 w-full min-w-0 rounded-xl border border-line bg-surface px-3.5 text-[15px] font-semibold outline-none focus:border-brand";
const labelText = "text-[12px] font-bold text-muted";

const toPaise = (s: string) => Math.round(parseFloat(s || "0") * 100);
const toRupees = (p: number) => (p ? String(p / 100) : "");

type RouteRow = {
  fromId: string | null;
  toId: string | null;
  oneway: string;
  roundtrip: string;
};

export default function EditCarForm({
  partnerId,
  car,
  routes,
  places,
  commissionBps,
  admin = false,
  backHref = "/partner/business",
}: {
  partnerId: string;
  car: CarDetail;
  routes: CarRouteInput[];
  places: CabPlace[];
  /** Andaman Go's commission on cab bookings, in basis points (1500 = 15%). */
  commissionBps: number;
  admin?: boolean;
  backHref?: string;
}) {
  const router = useRouter();
  const commissionPct = Math.round(commissionBps / 100);
  const platformFee = (paise: number) => Math.round((paise * commissionBps) / 10000);

  const [category, setCategory] = useState<CabCategory>(car.category);
  const [model, setModel] = useState(car.model);
  const [seats, setSeats] = useState(String(car.seats));
  const [luggage, setLuggage] = useState(String(car.luggage));
  const [ac, setAc] = useState(car.ac);
  const [fuel, setFuel] = useState<CabFuel>(car.fuel);
  const [boardNumber, setBoardNumber] = useState(car.boardNumber);
  const [fullDay, setFullDay] = useState(toRupees(car.fullDayPaise));
  const [airport, setAirport] = useState(toRupees(car.airportSurchargePaise));
  const [night, setNight] = useState(toRupees(car.nightSurchargePaise));
  const [perKm, setPerKm] = useState(toRupees(car.perKmPaise));
  const [perMin, setPerMin] = useState(toRupees(car.perMinPaise));
  const [meta, setMeta] = useState(car.meta);
  const [photoPaths, setPhotoPaths] = useState<string[]>(car.photoPaths);

  const [routeRows, setRouteRows] = useState<RouteRow[]>(
    routes.length
      ? routes.map((r) => ({
          fromId: r.fromPlaceId,
          toId: r.toPlaceId,
          oneway: toRupees(r.onewayPaise),
          roundtrip: toRupees(r.roundtripPaise),
        }))
      : [{ fromId: null, toId: null, oneway: "", roundtrip: "" }],
  );

  const [busy, setBusy] = useState<"photo" | "car" | "routes" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const airportPaise = toPaise(airport);
  const placeIsAirport = (id: string | null) =>
    places.find((p) => p.id === id)?.isAirport ?? false;

  const carInput = () => ({
    category,
    model,
    seats: parseInt(seats, 10) || 4,
    luggage: parseInt(luggage, 10) || 0,
    ac,
    fuel,
    boardNumber,
    fullDayPaise: toPaise(fullDay),
    airportSurchargePaise: airportPaise,
    nightSurchargePaise: toPaise(night),
    perKmPaise: toPaise(perKm),
    perMinPaise: toPaise(perMin),
    meta,
    photoPaths,
  });

  const saveCar = async () => {
    if (busy) return;
    setBusy("car");
    setProblem(null);
    setSaved(null);
    const result = await (admin ? adminUpdateCar : updatePartnerCar)(car.id, carInput());
    setBusy(null);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    setSaved(result.message);
    router.refresh();
  };

  const saveRoutes = async () => {
    if (busy) return;
    const clean = routeRows.filter(
      (r) => r.fromId && r.toId && r.fromId !== r.toId && toPaise(r.oneway) > 0,
    );
    setBusy("routes");
    setProblem(null);
    setSaved(null);
    const result = await (admin ? adminSetCarRoutes : setCarRoutes)(
      car.id,
      clean.map((r) => ({
        fromPlaceId: r.fromId as string,
        toPlaceId: r.toId as string,
        onewayPaise: toPaise(r.oneway),
        roundtripPaise: toPaise(r.roundtrip) || toPaise(r.oneway),
      })),
    );
    setBusy(null);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    setSaved(result.message);
    router.refresh();
  };

  const setRow = (i: number, patch: Partial<RouteRow>) =>
    setRouteRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  return (
    <>
      <Link
        href={backHref}
        className="flex items-center gap-1.5 text-[13px] font-bold text-muted"
      >
        <BackIcon size={14} />
        {admin ? "Back" : "Business"}
      </Link>

      <h2 className="font-display mt-3 text-[20px] font-bold tracking-tight">
        {car.model}
      </h2>
      <p className="mt-0.5 text-[12.5px] font-medium text-muted">
        {CATEGORY_LABEL[car.category]} · {FUEL_LABEL[car.fuel]}
      </p>

      {saved && (
        <p className="mt-3 rounded-xl border border-brandsoft bg-brandsoft px-3.5 py-2.5 text-[12.5px] font-semibold text-brand">
          {saved}
        </p>
      )}
      {problem && (
        <p className="mt-3 rounded-xl border border-sandline bg-sandsoft px-3.5 py-2.5 text-[12.5px] font-medium text-sandink2">
          {problem}
        </p>
      )}

      {/* --- Car details ---------------------------------------------------- */}
      <div className="mt-5 flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Type</span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as CabCategory)}
            className={inputClass}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Model</span>
          <input value={model} onChange={(e) => setModel(e.target.value)} className={inputClass} />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className={labelText}>Seats</span>
            <input
              type="number"
              value={seats}
              onChange={(e) => setSeats(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelText}>Luggage bags</span>
            <input
              type="number"
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
                <option key={f} value={f}>
                  {FUEL_LABEL[f]}
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
            className={inputClass}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Full-day fare (₹ per day)</span>
          <input
            type="number"
            value={fullDay}
            onChange={(e) => setFullDay(e.target.value)}
            className={inputClass}
          />
          {toPaise(fullDay) > 0 && (
            <span className="text-[11px] font-medium text-muted">
              Traveller pays {rupees(toPaise(fullDay))}/day · {commissionPct}% platform fee{" "}
              {rupees(platformFee(toPaise(fullDay)))} · you receive{" "}
              {rupees(toPaise(fullDay) - platformFee(toPaise(fullDay)))}/day
            </span>
          )}
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className={labelText}>Airport surcharge (₹)</span>
            <input
              type="number"
              value={airport}
              onChange={(e) => setAirport(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelText}>Night charge (₹)</span>
            <input
              type="number"
              value={night}
              onChange={(e) => setNight(e.target.value)}
              className={inputClass}
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className={labelText}>Your ₹/km (optional)</span>
            <input
              type="number"
              value={perKm}
              onChange={(e) => setPerKm(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelText}>Your ₹/min (optional)</span>
            <input
              type="number"
              value={perMin}
              onChange={(e) => setPerMin(e.target.value)}
              className={inputClass}
            />
          </label>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Anything a traveller should know (optional)</span>
          <input value={meta} onChange={(e) => setMeta(e.target.value)} className={inputClass} />
        </label>

        <PhotoGallery
          partnerId={partnerId}
          value={photoPaths}
          onChange={setPhotoPaths}
          onBusyChange={(b) => setBusy(b ? "photo" : null)}
        />

        <button
          type="button"
          disabled={busy === "car" || model.trim() === ""}
          onClick={saveCar}
          className="mt-1 h-14 w-full rounded-2xl bg-brand text-[15px] font-bold text-white disabled:bg-line disabled:text-muted"
        >
          {busy === "car" ? "Saving…" : "Save car details"}
        </button>
      </div>

      {/* --- Route fares -------------------------------------------------- */}
      <h3 className="font-display mt-8 text-[16px] font-bold tracking-tight">Route fares</h3>
      <p className="mt-1 text-[12px] font-medium text-muted">
        The fare a traveller pays for each pickup → drop you serve. The ≈ figure
        below is a hint from your ₹/km and ₹/min — set the real price yourself.
      </p>

      <div className="mt-4 flex flex-col gap-4">
        {routeRows.map((row, i) => {
          const kmHint =
            toPaise(perKm) > 0 ? ` · ≈ your ₹${perKm}/km` : "";
          const onewayPaise = toPaise(row.oneway);
          const surcharge =
            (placeIsAirport(row.fromId) || placeIsAirport(row.toId)) && airportPaise > 0
              ? airportPaise
              : 0;
          const travellerOneway = onewayPaise + surcharge;
          return (
            <div key={i} className="rounded-[16px] border border-line bg-surface p-3.5">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-bold text-muted">Route {i + 1}</span>
                {routeRows.length > 1 && (
                  <button
                    type="button"
                    aria-label="Remove route"
                    onClick={() => setRouteRows((r) => r.filter((_, idx) => idx !== i))}
                    className="text-muted"
                  >
                    <CloseIcon size={15} />
                  </button>
                )}
              </div>

              <div className="mt-2.5 flex flex-col gap-2">
                <PlacePicker
                  places={places}
                  value={row.fromId}
                  onChange={(id) => setRow(i, { fromId: id })}
                  placeholder="Pickup"
                  exclude={row.toId}
                />
                <PlacePicker
                  places={places}
                  value={row.toId}
                  onChange={(id) => setRow(i, { toId: id })}
                  placeholder="Drop"
                  exclude={row.fromId}
                />
              </div>

              <div className="mt-2 grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1.5">
                  <span className={labelText}>One-way (₹){kmHint}</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={row.oneway}
                    onChange={(e) => setRow(i, { oneway: e.target.value })}
                    className={inputClass}
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className={labelText}>Round trip (₹)</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={row.roundtrip}
                    onChange={(e) => setRow(i, { roundtrip: e.target.value })}
                    className={inputClass}
                  />
                </label>
              </div>

              {travellerOneway > 0 && (
                <div className="mt-2.5 rounded-xl bg-ground p-2.5 text-[11.5px] font-medium">
                  <p className="font-bold text-ink">What the traveller sees</p>
                  <p className="mt-0.5 text-muted">
                    One-way{" "}
                    <span className="font-bold text-ink">{rupees(travellerOneway)}</span>
                    {surcharge > 0 && ` (incl. ${rupees(surcharge)} airport surcharge)`}
                    {toPaise(row.roundtrip) > 0 && (
                      <>
                        {" · "}round trip{" "}
                        <span className="font-bold text-ink">
                          {rupees(toPaise(row.roundtrip) + surcharge)}
                        </span>
                      </>
                    )}
                  </p>
                  <p className="mt-0.5 text-muted">
                    Traveller pays {rupees(travellerOneway)} · {commissionPct}% platform fee{" "}
                    {rupees(platformFee(travellerOneway))} · you receive{" "}
                    {rupees(travellerOneway - platformFee(travellerOneway))}
                  </p>
                </div>
              )}
            </div>
          );
        })}

        <button
          type="button"
          onClick={() =>
            setRouteRows((r) => [...r, { fromId: null, toId: null, oneway: "", roundtrip: "" }])
          }
          className="flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-line py-3 text-[13px] font-bold text-brand"
        >
          <PlusIcon size={15} />
          Add another route
        </button>

        <button
          type="button"
          disabled={busy === "routes"}
          onClick={saveRoutes}
          className="h-14 w-full rounded-2xl bg-brand text-[15px] font-bold text-white disabled:bg-line disabled:text-muted"
        >
          {busy === "routes" ? "Saving…" : "Save route fares"}
        </button>
      </div>

      <p className="mt-4 flex items-center gap-1.5 text-[11.5px] font-medium text-muted">
        <CheckIcon size={13} className="text-brand" />
        Full-day hires don&apos;t need routes — they use the full-day fare above.
      </p>
    </>
  );
}
