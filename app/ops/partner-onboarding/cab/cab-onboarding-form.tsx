"use client";

import { useState } from "react";
import { ISLANDS } from "@/lib/islands";
import { rupees } from "@/lib/activities";
import { LISTING_PHOTO_MAX } from "@/lib/photos";
import type { CabCategory, CabFuel } from "@/lib/cabs";
import { onboardCabPartner, saveOpsCabPhotos } from "./actions";
import OpsPhotoPicker from "../ops-photo-picker";

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
const sectionTitle = "text-[11px] font-bold tracking-[1.2px] text-muted uppercase";

const toPaise = (s: string) => Math.round(parseFloat(s || "0") * 100);

export default function CabOnboardingForm({ commissionBps }: { commissionBps: number }) {
  const commissionPct = Math.round(commissionBps / 100);
  const platformFee = (paise: number) => Math.round((paise * commissionBps) / 10000);

  // Partner / business fields
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [islandSlug, setIslandSlug] = useState<string>(ISLANDS[0].slug);
  const [address, setAddress] = useState("");
  const [mapsUrl, setMapsUrl] = useState("");

  // Cab fields — same as the partner-side car-form.tsx
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

  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [registered, setRegistered] = useState<{
    partnerId: string;
    cabId: string;
    tempPassword: string;
    email: string;
  } | null>(null);
  const [coverPhoto, setCoverPhoto] = useState<string[]>([]);
  const [listingPhotos, setListingPhotos] = useState<string[]>([]);
  const [done, setDone] = useState<{ tempPassword: string; email: string } | null>(null);

  const fullDayPaise = toPaise(fullDay);
  const canSubmit =
    businessName.trim() !== "" &&
    email.trim() !== "" &&
    address.trim() !== "" &&
    model.trim() !== "" &&
    fullDay.trim() !== "" &&
    fullDayPaise >= 0 &&
    !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setProblem(null);

    const result = await onboardCabPartner({
      businessName,
      email,
      phone,
      islandSlug,
      address,
      mapsUrl,
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
    });

    if (!result.ok) {
      setProblem(result.message);
      setBusy(false);
      return;
    }

    setRegistered({
      partnerId: result.partnerId,
      cabId: result.cabId,
      tempPassword: result.tempPassword,
      email,
    });
    setBusy(false);
  };

  const finishWithPhotos = async () => {
    if (!registered) return;
    setBusy(true);
    await saveOpsCabPhotos(
      registered.partnerId,
      registered.cabId,
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
          label="Cab photos (the first one is the cover travellers see)"
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
            placeholder="Andaman Cabs Co."
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
          <span className={labelText}>Google Maps link (optional)</span>
          <input
            value={mapsUrl}
            onChange={(e) => setMapsUrl(e.target.value)}
            placeholder="https://maps.app.goo.gl/..."
            className={inputClass}
          />
        </label>
      </div>

      <div className="flex flex-col gap-3">
        <span className={sectionTitle}>First cab</span>
        <p className="-mt-1 text-[12px] font-medium text-muted">
          Commission is negotiated per business and set on their partner record once they&apos;re in
          the console — figures below use {commissionPct}% as a starting-point estimate, collected
          online at checkout.
        </p>

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
              {rupees(platformFee(fullDayPaise))} · partner receives{" "}
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

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className={labelText}>₹/km (optional)</span>
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
            <span className={labelText}>₹/min (optional)</span>
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

        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Anything a traveller should know (optional)</span>
          <input
            value={meta}
            onChange={(e) => setMeta(e.target.value)}
            placeholder="Experienced driver, child seat on request"
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
