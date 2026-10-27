"use client";

// Mirrors business/new/vehicle/vehicle-form.tsx — same fields, same
// validation, prefilled from what's already on the row. Type isn't
// editable here — see 013-partner-listing-edits.sql for why.

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { updatePartnerVehicle, setPartnerShopArea, type VehicleDetail } from "@/lib/partner-register";
import { adminUpdateVehicle, adminSetPartnerArea } from "@/lib/admin-listing-edit";
import PhotoGallery from "@/app/partner/(dashboard)/business/photo-gallery";
import { BackIcon } from "@/app/icons";

const inputClass =
  "h-12 w-full min-w-0 rounded-xl border border-line bg-surface px-3.5 text-[15px] font-semibold outline-none focus:border-brand";
const labelText = "text-[12px] font-bold text-muted";

export default function EditVehicleForm({
  partnerId,
  vehicle,
  admin = false,
  backHref = "/partner/business",
}: {
  partnerId: string;
  vehicle: VehicleDetail;
  admin?: boolean;
  backHref?: string;
}) {
  const router = useRouter();
  const [model, setModel] = useState(vehicle.model);
  const [rateRupees, setRateRupees] = useState(String(vehicle.ratePaise / 100));
  const [seats, setSeats] = useState(String(vehicle.seats));
  const [meta, setMeta] = useState(vehicle.meta);
  const [units, setUnits] = useState(String(vehicle.units));
  const [depositRupees, setDepositRupees] = useState(String(vehicle.securityDepositPaise / 100));
  const [shopArea, setShopArea] = useState(vehicle.shopArea);
  const [shopMapsUrl, setShopMapsUrl] = useState(vehicle.shopMapsUrl);
  const [photoPaths, setPhotoPaths] = useState<string[]>(vehicle.photoPaths);
  const [busy, setBusy] = useState<"photo" | "submit" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const rate = Math.round(parseFloat(rateRupees || "0") * 100);
  const deposit = Math.round(parseFloat(depositRupees || "0") * 100);
  const canSubmit =
    model.trim() !== "" &&
    rateRupees.trim() !== "" &&
    !isNaN(rate) &&
    rate >= 0 &&
    !isNaN(deposit) &&
    deposit >= 0 &&
    shopArea.trim() !== "" &&
    shopMapsUrl.trim() !== "" &&
    !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy("submit");
    setProblem(null);

    const result = await (admin ? adminUpdateVehicle : updatePartnerVehicle)(vehicle.id, {
      model,
      ratePaise: rate,
      seats: parseInt(seats, 10) || 2,
      meta,
      units: parseInt(units, 10) || 1,
      securityDepositPaise: deposit,
      photoPaths,
    });

    if (!result.ok) {
      setProblem(result.message);
      setBusy(null);
      return;
    }

    // The shop's area and map link, not the vehicle's — same columns the
    // Business tab's profile editor writes (127/128), settable right from
    // here too, and required (130).
    const areaResult = await (admin
      ? adminSetPartnerArea(partnerId, shopArea, shopMapsUrl)
      : setPartnerShopArea(shopArea, shopMapsUrl));
    if (!areaResult.ok) {
      setProblem(areaResult.message);
      setBusy(null);
      return;
    }

    router.push(backHref);
  };

  return (
    <>
      <Link href={backHref} className="flex items-center gap-1.5 text-[13px] font-bold text-muted">
        <BackIcon size={14} />
        {admin ? "Back" : "Business"}
      </Link>

      <h2 className="font-display mt-3 text-[20px] font-bold tracking-tight">Edit rental vehicle</h2>

      <div className="mt-5 flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Model</span>
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Activa 5G" className={inputClass} />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Rate per day (₹)</span>
          <input
            type="number"
            inputMode="decimal"
            value={rateRupees}
            onChange={(e) => setRateRupees(e.target.value)}
            placeholder="600"
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
            <span className={labelText}>How many you have</span>
            <input
              type="number"
              inputMode="numeric"
              value={units}
              onChange={(e) => setUnits(e.target.value)}
              className={inputClass}
            />
            <span className="text-[11px] font-medium text-muted">
              Total identical units, e.g. 5 — don&apos;t list the same scooter 5 times. Stock drops with
              each booking and shows &quot;Sold out&quot; to travellers at 0.
            </span>
          </label>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Security deposit (₹)</span>
          <input
            type="number"
            inputMode="decimal"
            value={depositRupees}
            onChange={(e) => setDepositRupees(e.target.value)}
            placeholder="0"
            className={inputClass}
          />
          <span className="text-[11px] font-medium text-muted">
            Shown to the traveller, collected by you at pick-up. 0 for none.
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Anything a traveller should know (optional)</span>
          <input
            value={meta}
            onChange={(e) => setMeta(e.target.value)}
            placeholder="Automatic, helmet included"
            className={inputClass}
          />
        </label>

        <label className="flex flex-col gap-1.5 border-t border-hairline pt-4">
          <span className={labelText}>Shop area (required)</span>
          <input
            value={shopArea}
            onChange={(e) => setShopArea(e.target.value)}
            placeholder="Aberdeen Bazaar"
            className={inputClass}
          />
          <span className="text-[11px] font-medium text-muted">
            Where your shop actually is — shown on every one of your listings, not just this one.
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Shop map link (required)</span>
          <input
            value={shopMapsUrl}
            onChange={(e) => setShopMapsUrl(e.target.value)}
            placeholder="Paste a Google Maps share link"
            className={inputClass}
          />
          <span className="text-[11px] font-medium text-muted">
            So Directions sends travellers to the right place.
          </span>
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
          {busy === "submit" ? "Saving…" : "Save changes"}
        </button>
      </div>
    </>
  );
}
