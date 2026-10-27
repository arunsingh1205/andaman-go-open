"use client";

import { useState } from "react";
import { ISLANDS } from "@/lib/islands";
import { LISTING_PHOTO_MAX } from "@/lib/photos";
import type { VehicleType } from "@/lib/partner-register";
import { onboardRentalPartner, saveOpsRentalPhotos } from "./actions";
import OpsPhotoPicker from "../ops-photo-picker";

const TYPE_OPTIONS: { value: VehicleType; label: string }[] = [
  { value: "scooter", label: "Scooter" },
  { value: "bike", label: "Bike" },
  { value: "bicycle", label: "Bicycle" },
];

const inputClass =
  "h-12 w-full min-w-0 rounded-xl border border-line bg-surface px-3.5 text-[15px] font-semibold outline-none focus:border-brand";
const labelText = "text-[12px] font-bold text-muted";
const sectionTitle = "text-[11px] font-bold tracking-[1.2px] text-muted uppercase";

const toPaise = (s: string) => Math.round(parseFloat(s || "0") * 100);

export default function RentalOnboardingForm() {
  // Partner / business fields
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [islandSlug, setIslandSlug] = useState<string>(ISLANDS[0].slug);
  const [address, setAddress] = useState("");
  const [area, setArea] = useState("");
  const [mapsUrl, setMapsUrl] = useState("");

  // Vehicle fields — same as the partner-side vehicle-form.tsx
  const [type, setType] = useState<VehicleType>("scooter");
  const [model, setModel] = useState("");
  const [rateRupees, setRateRupees] = useState("");
  const [seats, setSeats] = useState("2");
  const [units, setUnits] = useState("1");
  const [depositRupees, setDepositRupees] = useState("");
  const [meta, setMeta] = useState("");

  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [registered, setRegistered] = useState<{
    partnerId: string;
    vehicleId: string;
    tempPassword: string;
    email: string;
  } | null>(null);
  const [coverPhoto, setCoverPhoto] = useState<string[]>([]);
  const [listingPhotos, setListingPhotos] = useState<string[]>([]);
  const [done, setDone] = useState<{ tempPassword: string; email: string } | null>(null);

  const rate = toPaise(rateRupees);
  const deposit = toPaise(depositRupees);
  const canSubmit =
    businessName.trim() !== "" &&
    email.trim() !== "" &&
    address.trim() !== "" &&
    area.trim() !== "" &&
    mapsUrl.trim() !== "" &&
    model.trim() !== "" &&
    rateRupees.trim() !== "" &&
    rate >= 0 &&
    !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setProblem(null);

    const result = await onboardRentalPartner({
      businessName,
      email,
      phone,
      islandSlug,
      address,
      area,
      mapsUrl,
      type,
      model,
      ratePaise: rate,
      seats: parseInt(seats, 10) || 2,
      units: parseInt(units, 10) || 1,
      securityDepositPaise: deposit,
      meta,
    });

    if (!result.ok) {
      setProblem(result.message);
      setBusy(false);
      return;
    }

    setRegistered({
      partnerId: result.partnerId,
      vehicleId: result.vehicleId,
      tempPassword: result.tempPassword,
      email,
    });
    setBusy(false);
  };

  const finishWithPhotos = async () => {
    if (!registered) return;
    setBusy(true);
    await saveOpsRentalPhotos(
      registered.partnerId,
      registered.vehicleId,
      coverPhoto[0] ?? null,
      listingPhotos,
    );
    setDone({ tempPassword: registered.tempPassword, email: registered.email });
    setBusy(false);
  };

  if (registered && !done) {
    return (
      <div className="mt-6 flex flex-col gap-5">
        <p className="text-[13px] leading-relaxed font-medium text-muted">
          Partner registered. Add photos now if you have them on hand, or skip — the partner can
          add these themselves once they sign in.
        </p>

        <OpsPhotoPicker
          partnerId={registered.partnerId}
          value={coverPhoto}
          onChange={setCoverPhoto}
          max={1}
          label="Cover photo (shown on the business card)"
        />

        <OpsPhotoPicker
          partnerId={registered.partnerId}
          value={listingPhotos}
          onChange={setListingPhotos}
          max={LISTING_PHOTO_MAX}
          label="Vehicle photos (the first one is the cover travellers see)"
        />

        <button
          type="button"
          disabled={busy}
          onClick={finishWithPhotos}
          className="h-14 w-full rounded-2xl bg-brand text-[15px] font-bold text-white disabled:opacity-60"
        >
          {busy ? "Saving…" : coverPhoto.length || listingPhotos.length ? "Save and finish" : "Skip for now"}
        </button>
      </div>
    );
  }

  if (done) {
    return (
      <div className="mt-6 rounded-2xl border border-line bg-surface p-5">
        <h2 className="text-[16px] font-bold text-ink">Partner onboarded</h2>
        <p className="mt-2 text-[13px] leading-relaxed font-medium text-muted">
          A &quot;set your password&quot; link was sent to <strong>{done.email}</strong>. If they
          don&apos;t get it, hand them this temporary password on-site — it works immediately and
          they&apos;ll still be asked to set a real one on first login.
        </p>
        <p className="mt-3 rounded-xl border border-line bg-white px-4 py-3 text-center text-[16px] font-bold tracking-wide text-ink">
          {done.tempPassword}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 h-12 w-full rounded-xl bg-brand text-[14px] font-bold text-white"
        >
          Onboard another partner
        </button>
      </div>
    );
  }

  return (
    <div className="mt-5 flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <span className={sectionTitle}>Business</span>

        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Business name</span>
          <input
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            placeholder="Andaman Scooty Rentals"
            className={inputClass}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Partner email (becomes their login)</span>
          <input
            type="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="partner@example.com"
            className={inputClass}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Phone</span>
          <input
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="9876543210"
            className={inputClass}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Island</span>
          <select
            value={islandSlug}
            onChange={(e) => setIslandSlug(e.target.value)}
            className={inputClass}
          >
            {ISLANDS.map((island) => (
              <option key={island.slug} value={island.slug}>
                {island.full}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Address</span>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Beach No 5, Havelock"
            className={inputClass}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Shop area (required)</span>
          <input
            value={area}
            onChange={(e) => setArea(e.target.value)}
            placeholder="Aberdeen Bazaar"
            className={inputClass}
          />
          <span className="text-[11px] font-medium text-muted">
            Where the shop actually is — shown on every one of their listings.
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Shop map link (required)</span>
          <input
            value={mapsUrl}
            onChange={(e) => setMapsUrl(e.target.value)}
            placeholder="Paste a Google Maps share link"
            className={inputClass}
          />
        </label>
      </div>

      <div className="flex flex-col gap-3">
        <span className={sectionTitle}>First vehicle</span>

        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Type</span>
          <select value={type} onChange={(e) => setType(e.target.value as VehicleType)} className={inputClass}>
            {TYPE_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Model</span>
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="Activa 5G"
            className={inputClass}
          />
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
            <span className={labelText}>How many they have</span>
            <input
              type="number"
              inputMode="numeric"
              value={units}
              onChange={(e) => setUnits(e.target.value)}
              className={inputClass}
            />
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
            Shown to the traveller, collected by the partner at pick-up. Leave blank for none.
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
      </div>

      {problem && <p className="text-[12.5px] font-medium text-warn">{problem}</p>}

      <button
        type="button"
        disabled={!canSubmit}
        onClick={submit}
        className="h-14 w-full rounded-2xl bg-brand text-[15px] font-bold text-white disabled:bg-line disabled:text-muted"
      >
        {busy ? "Onboarding…" : "Onboard partner"}
      </button>
    </div>
  );
}
