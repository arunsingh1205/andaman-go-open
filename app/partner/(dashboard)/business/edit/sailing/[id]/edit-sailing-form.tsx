"use client";

// Mirrors business/new/sailing/sailing-form.tsx — same fields, same
// validation, prefilled from what's already on the row. The route (from/to
// island) isn't editable here — see 016's own comment for why, same
// reasoning 013 already applied to category/type on the other three kinds.

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { updatePartnerSailing, type BadgeTone, type SailingDetail } from "@/lib/partner-register";
import { adminUpdateSailing } from "@/lib/admin-listing-edit";
import PhotoGallery from "@/app/partner/(dashboard)/business/photo-gallery";
import { ISLANDS } from "@/lib/islands";
import { BackIcon } from "@/app/icons";

const WEEKDAYS = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];

const TONE_OPTIONS: { value: BadgeTone; label: string }[] = [
  { value: "plain", label: "Plain" },
  { value: "good", label: "Good (green)" },
  { value: "warm", label: "Warm (amber)" },
];

function minsToTime(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function timeToMins(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function islandName(slug: string): string {
  return ISLANDS.find((i) => i.slug === slug)?.name ?? slug;
}

const inputClass =
  "h-12 w-full min-w-0 rounded-xl border border-line bg-surface px-3.5 text-[15px] font-semibold outline-none focus:border-brand";
const labelText = "text-[12px] font-bold text-muted";

export default function EditSailingForm({
  partnerId,
  sailing,
  admin = false,
  backHref = "/partner/business",
}: {
  partnerId: string;
  sailing: SailingDetail;
  admin?: boolean;
  backHref?: string;
}) {
  const router = useRouter();
  const [styleLabel, setStyleLabel] = useState(sailing.styleLabel);
  const [depTime, setDepTime] = useState(minsToTime(sailing.depMins));
  const [durationMins, setDurationMins] = useState(String(sailing.durationMins));
  const [fareRupees, setFareRupees] = useState(String(sailing.farePaise / 100));
  const [capacity, setCapacity] = useState(String(sailing.capacity));
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(sailing.daysOfWeek);
  const [styleTone, setStyleTone] = useState<BadgeTone>(sailing.styleTone);
  const [info, setInfo] = useState(sailing.info);
  const [infoWarn, setInfoWarn] = useState(sailing.infoWarn);
  const [photoPaths, setPhotoPaths] = useState<string[]>(sailing.photoPaths);
  const [busy, setBusy] = useState<"photo" | "submit" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const farePaise = Math.round(parseFloat(fareRupees || "0") * 100);
  const capacityNum = parseInt(capacity || "0", 10);
  const durationNum = parseInt(durationMins || "0", 10);

  const canSubmit =
    styleLabel.trim() !== "" &&
    fareRupees.trim() !== "" &&
    !isNaN(farePaise) &&
    farePaise >= 0 &&
    capacityNum >= 1 &&
    durationNum >= 1 &&
    daysOfWeek.length > 0 &&
    !busy;

  const toggleDay = (day: number) => {
    setDaysOfWeek((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()));
  };

  const submit = async () => {
    if (!canSubmit) return;
    setBusy("submit");
    setProblem(null);

    const result = await (admin ? adminUpdateSailing : updatePartnerSailing)(sailing.id, {
      styleLabel,
      depMins: timeToMins(depTime),
      durationMins: durationNum,
      farePaise,
      capacity: capacityNum,
      daysOfWeek,
      styleTone,
      info,
      infoWarn,
      photoPaths,
    });

    if (!result.ok) {
      setProblem(result.message);
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

      <h2 className="font-display mt-3 text-[20px] font-bold tracking-tight">Edit ferry sailing</h2>
      <p className="mt-1 text-[12.5px] font-medium text-muted">
        {islandName(sailing.fromIsland)} → {islandName(sailing.toIsland)}. To change the route, add a fresh
        sailing instead.
      </p>

      <div className="mt-5 flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Ticket class name</span>
          <input
            value={styleLabel}
            onChange={(e) => setStyleLabel(e.target.value)}
            placeholder="Deluxe"
            className={inputClass}
          />
        </label>

        <div className="flex gap-3">
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className={labelText}>Departure time</span>
            <input type="time" value={depTime} onChange={(e) => setDepTime(e.target.value)} className={inputClass} />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className={labelText}>Journey time (mins)</span>
            <input
              type="number"
              inputMode="numeric"
              value={durationMins}
              onChange={(e) => setDurationMins(e.target.value)}
              className={inputClass}
            />
          </label>
        </div>

        <div className="flex gap-3">
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className={labelText}>Fare (₹)</span>
            <input
              type="number"
              inputMode="decimal"
              value={fareRupees}
              onChange={(e) => setFareRupees(e.target.value)}
              placeholder="1200"
              className={inputClass}
            />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className={labelText}>Capacity</span>
            <input
              type="number"
              inputMode="numeric"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              placeholder="40"
              className={inputClass}
            />
          </label>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className={labelText}>Runs on</span>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAYS.map((d) => (
              <button
                key={d.value}
                type="button"
                onClick={() => toggleDay(d.value)}
                className={`h-9 rounded-lg px-3 text-[12.5px] font-bold ${
                  daysOfWeek.includes(d.value) ? "bg-brand text-white" : "border border-line bg-surface text-muted"
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Badge style</span>
          <select value={styleTone} onChange={(e) => setStyleTone(e.target.value as BadgeTone)} className={inputClass}>
            {TONE_OPTIONS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Notice line (optional)</span>
          <input
            value={info}
            onChange={(e) => setInfo(e.target.value)}
            placeholder="Window seats available"
            className={inputClass}
          />
        </label>

        <label className="flex items-center gap-2">
          <input type="checkbox" checked={infoWarn} onChange={(e) => setInfoWarn(e.target.checked)} className="h-4 w-4" />
          <span className="text-[12.5px] font-semibold text-ink">Show the notice as a warning</span>
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
