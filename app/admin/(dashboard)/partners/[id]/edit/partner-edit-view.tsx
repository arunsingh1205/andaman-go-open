"use client";

// The admin's version of the partner Business-tab profile editor. Same fields
// the partner can set themselves, plus name / island (which they can't), all
// routed through the admin_* RPCs in 075. Deliberately its own component
// rather than a reuse of the partner's BusinessView, which is a monolith of
// listings + resubmit + policy that has no place here.

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  adminSetPartnerContactPhone,
  adminSetPartnerWhatsappNumber,
  adminSetRentalHours,
  adminUpdatePartnerProfile,
} from "@/lib/admin-listing-edit";
import type { OwnBusiness, RentalHour } from "@/lib/partner-register";
import { uploadPartnerFile, partnerPhotoUrl } from "@/lib/partner-storage";
import { KIND_NEEDS_LICENSE, PARTNER_KIND_LABEL } from "@/lib/partner-kind";
import { ISLANDS } from "@/lib/islands";
import { BackIcon } from "@/app/icons";

const inputClass =
  "h-11 rounded-xl border border-line bg-surface px-3.5 text-[14px] font-semibold outline-none focus:border-brand";
const labelText = "text-[12px] font-bold text-muted";
const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const toClock = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const toMins = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

export default function PartnerEditView({
  business,
  rentalHours,
}: {
  business: OwnBusiness;
  rentalHours: RentalHour[];
}) {
  const router = useRouter();
  const backHref = `/admin/partners/${business.id}`;

  const [name, setName] = useState(business.name);
  const [islandSlug, setIslandSlug] = useState(
    ISLANDS.some((i) => i.slug === business.islandSlug) ? business.islandSlug : ISLANDS[0].slug,
  );
  const [area, setArea] = useState(business.area ?? "");
  const [address, setAddress] = useState(business.address ?? "");
  const [mapsUrl, setMapsUrl] = useState(business.mapsUrl ?? "");
  const [licenseNumber, setLicenseNumber] = useState(business.licenseNumber ?? "");
  const [coverPhotoPath, setCoverPhotoPath] = useState(business.coverPhotoPath);
  const [licenseDocPath, setLicenseDocPath] = useState(business.licenseDocPath);
  const [phone, setPhone] = useState("");
  const [whatsapp, setWhatsapp] = useState("");

  const [busy, setBusy] = useState<"cover" | "license" | "details" | "phone" | "whatsapp" | null>(
    null,
  );
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const coverInput = useRef<HTMLInputElement>(null);
  const licenseInput = useRef<HTMLInputElement>(null);
  const needsLicense = KIND_NEEDS_LICENSE[business.kind] === true;

  const saveProfile = async (next?: {
    coverPhotoPath?: string | null;
    licenseDocPath?: string | null;
  }) => {
    setProblem(null);
    const result = await adminUpdatePartnerProfile(business.id, {
      name,
      islandSlug,
      area,
      address,
      mapsUrl,
      licenseNumber,
      coverPhotoPath: next?.coverPhotoPath !== undefined ? next.coverPhotoPath : coverPhotoPath,
      licenseDocPath: next?.licenseDocPath !== undefined ? next.licenseDocPath : licenseDocPath,
    });
    if (!result.ok) {
      setProblem(result.message);
      return false;
    }
    setSaved("Profile saved.");
    setTimeout(() => setSaved(null), 2500);
    router.refresh();
    return true;
  };

  const onCoverChosen = async (file: File | undefined) => {
    if (!file) return;
    setBusy("cover");
    setProblem(null);
    if (coverInput.current) coverInput.current.value = "";
    const uploaded = await uploadPartnerFile("partner-photos", business.id, file);
    if (!uploaded.ok) {
      setProblem(uploaded.message);
      setBusy(null);
      return;
    }
    setCoverPhotoPath(uploaded.path);
    await saveProfile({ coverPhotoPath: uploaded.path });
    setBusy(null);
  };

  const onLicenseChosen = async (file: File | undefined) => {
    if (!file) return;
    setBusy("license");
    setProblem(null);
    if (licenseInput.current) licenseInput.current.value = "";
    const uploaded = await uploadPartnerFile("partner-licenses", business.id, file);
    if (!uploaded.ok) {
      setProblem(uploaded.message);
      setBusy(null);
      return;
    }
    setLicenseDocPath(uploaded.path);
    await saveProfile({ licenseDocPath: uploaded.path });
    setBusy(null);
  };

  const saveDetails = async () => {
    setBusy("details");
    await saveProfile();
    setBusy(null);
  };

  const savePhone = async () => {
    setBusy("phone");
    setProblem(null);
    const result = await adminSetPartnerContactPhone(business.id, phone);
    setBusy(null);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    setSaved("Contact number saved.");
    setTimeout(() => setSaved(null), 2500);
  };

  const saveWhatsapp = async () => {
    setBusy("whatsapp");
    setProblem(null);
    const result = await adminSetPartnerWhatsappNumber(business.id, whatsapp);
    setBusy(null);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    setSaved("WhatsApp number saved.");
    setTimeout(() => setSaved(null), 2500);
  };

  return (
    <div className="mx-auto max-w-[560px]">
      <Link
        href={backHref}
        className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] font-bold text-muted hover:text-ink"
      >
        <BackIcon size={15} />
        {business.name}
      </Link>

      <div className="rounded-2xl border border-line bg-surface p-5">
        <h1 className="font-display text-[20px] font-bold tracking-tight">Edit business details</h1>
        <p className="mt-0.5 text-[12px] font-medium text-muted">
          {PARTNER_KIND_LABEL[business.kind]} · editing on the partner&apos;s behalf
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

        <div className="mt-5 flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className={labelText}>Business name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className={labelText}>Island</span>
            <select
              value={islandSlug}
              onChange={(e) => setIslandSlug(e.target.value)}
              className={inputClass}
            >
              {ISLANDS.map((i) => (
                <option key={i.slug} value={i.slug}>
                  {i.full}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className={labelText}>Area</span>
            <input
              value={area}
              onChange={(e) => setArea(e.target.value)}
              placeholder="Aberdeen Bazaar"
              className={inputClass}
            />
            <p className="text-[11px] font-medium text-muted">
              Shown on the traveller-facing card so people can find something nearby first.
            </p>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className={labelText}>Address</span>
            <textarea
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              rows={2}
              className="rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[14px] font-semibold outline-none focus:border-brand"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className={labelText}>Google Maps link</span>
            <input
              value={mapsUrl}
              onChange={(e) => setMapsUrl(e.target.value)}
              placeholder="Paste a Google Maps share link"
              className={inputClass}
            />
          </label>

          <div className="flex flex-col gap-1.5">
            <span className={labelText}>Cover photo</span>
            <div className="flex items-center gap-3">
              {coverPhotoPath ? (
                <Image
                  src={partnerPhotoUrl(coverPhotoPath)}
                  alt="Cover"
                  width={64}
                  height={64}
                  className="h-16 w-16 rounded-xl border border-line object-cover"
                />
              ) : (
                <span className="flex h-16 w-16 items-center justify-center rounded-xl border border-dashed border-line text-[10px] font-medium text-muted">
                  No photo
                </span>
              )}
              <button
                type="button"
                disabled={busy === "cover"}
                onClick={() => coverInput.current?.click()}
                className="h-10 rounded-xl border border-line bg-surface px-4 text-[12.5px] font-bold text-ink disabled:opacity-50"
              >
                {busy === "cover" ? "Uploading…" : coverPhotoPath ? "Replace photo" : "Add photo"}
              </button>
              <input
                ref={coverInput}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => onCoverChosen(e.target.files?.[0])}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5 border-t border-hairline pt-3">
            <span className={labelText}>
              Licence {needsLicense ? "— required for this category" : "(optional)"}
            </span>
            <input
              value={licenseNumber}
              onChange={(e) => setLicenseNumber(e.target.value)}
              placeholder="Licence number"
              className={inputClass}
            />
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={busy === "license"}
                onClick={() => licenseInput.current?.click()}
                className="h-10 rounded-xl border border-line bg-surface px-4 text-[12.5px] font-bold text-ink disabled:opacity-50"
              >
                {busy === "license"
                  ? "Uploading…"
                  : licenseDocPath
                    ? "Replace document"
                    : "Upload document"}
              </button>
              {licenseDocPath && <span className="text-[12px] font-medium text-muted">Uploaded ✓</span>}
              <input
                ref={licenseInput}
                type="file"
                accept="application/pdf,.pdf,image/*,.jpg,.jpeg,.png,.webp,.heic,.heif"
                hidden
                onChange={(e) => onLicenseChosen(e.target.files?.[0])}
              />
            </div>
          </div>

          <button
            type="button"
            disabled={busy === "details" || name.trim() === ""}
            onClick={saveDetails}
            className="mt-1 h-12 w-full rounded-xl bg-brand text-[13.5px] font-bold text-white disabled:bg-line disabled:text-muted"
          >
            {busy === "details" ? "Saving…" : "Save business details"}
          </button>
        </div>

        <div className="mt-6 border-t border-hairline pt-4">
          <span className={labelText}>Contact number</span>
          <p className="mt-0.5 text-[11.5px] font-medium text-muted">
            Overwrites the number on file. Leave blank and save to clear it.
          </p>
          <div className="mt-2 flex gap-2">
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+91…"
              className={`${inputClass} flex-1`}
            />
            <button
              type="button"
              disabled={busy === "phone"}
              onClick={savePhone}
              className="h-11 shrink-0 rounded-xl bg-brand px-4 text-[13px] font-bold text-white disabled:bg-line disabled:text-muted"
            >
              {busy === "phone" ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

        <div className="mt-6 border-t border-hairline pt-4">
          <span className={labelText}>WhatsApp number</span>
          <p className="mt-0.5 text-[11.5px] font-medium text-muted">
            Where booking and settlement WhatsApp messages get sent. Leave blank and save to clear
            it.
          </p>
          <div className="mt-2 flex gap-2">
            <input
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              placeholder="+91…"
              className={`${inputClass} flex-1`}
            />
            <button
              type="button"
              disabled={busy === "whatsapp"}
              onClick={saveWhatsapp}
              className="h-11 shrink-0 rounded-xl bg-brand px-4 text-[13px] font-bold text-white disabled:bg-line disabled:text-muted"
            >
              {busy === "whatsapp" ? "Saving…" : "Save"}
            </button>
          </div>
        </div>

        {business.kind === "rental" && (
          <RentalHoursEditor partnerId={business.id} initial={rentalHours} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

type DayRow = { open: boolean; openMins: number; closeMins: number };

function RentalHoursEditor({ partnerId, initial }: { partnerId: string; initial: RentalHour[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<DayRow[]>(() =>
    Array.from({ length: 7 }, (_, dow) => {
      const found = initial.find((h) => h.dow === dow);
      return found
        ? { open: true, openMins: found.openMins, closeMins: found.closeMins }
        : { open: false, openMins: 9 * 60, closeMins: 18 * 60 };
    }),
  );
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const set = (dow: number, patch: Partial<DayRow>) => {
    setRows((r) => r.map((d, i) => (i === dow ? { ...d, ...patch } : d)));
    setSaved(false);
  };

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const hours: RentalHour[] = rows
      .map((d, dow) => ({ dow, openMins: d.openMins, closeMins: d.closeMins, open: d.open }))
      .filter((d) => d.open)
      .map(({ dow, openMins, closeMins }) => ({ dow, openMins, closeMins }));

    if (hours.length === 0) {
      setProblem("Open at least one day.");
      setBusy(false);
      return;
    }
    if (hours.some((h) => h.openMins >= h.closeMins)) {
      setProblem("Each open day needs an opening time before its closing time.");
      setBusy(false);
      return;
    }

    const result = await adminSetRentalHours(partnerId, hours);
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    setSaved(true);
    router.refresh();
  };

  return (
    <section className="mt-6 border-t border-hairline pt-4">
      <p className={labelText}>Pick-up hours</p>
      <p className="mt-0.5 text-[11.5px] font-medium text-muted">
        When travellers can collect a vehicle. A booking outside these hours is turned away.
      </p>
      <div className="mt-2.5 flex flex-col gap-1.5">
        {rows.map((d, dow) => (
          <div
            key={dow}
            className="flex items-center gap-2.5 rounded-xl border border-line bg-surface p-2.5"
          >
            <label className="flex w-[92px] shrink-0 items-center gap-2 text-[12px] font-bold">
              <input
                type="checkbox"
                checked={d.open}
                onChange={(e) => set(dow, { open: e.target.checked })}
              />
              {DOW[dow].slice(0, 3)}
            </label>
            {d.open ? (
              <div className="flex items-center gap-1.5 text-[12px] font-semibold">
                <input
                  type="time"
                  value={toClock(d.openMins)}
                  onChange={(e) => set(dow, { openMins: toMins(e.target.value) })}
                  className="rounded-lg border border-line bg-ground px-2 py-1"
                />
                <span className="text-muted">to</span>
                <input
                  type="time"
                  value={toClock(d.closeMins)}
                  onChange={(e) => set(dow, { closeMins: toMins(e.target.value) })}
                  className="rounded-lg border border-line bg-ground px-2 py-1"
                />
              </div>
            ) : (
              <span className="text-[12px] font-medium text-muted">Closed</span>
            )}
          </div>
        ))}
      </div>
      {problem && <p className="mt-2 text-[11.5px] font-medium text-warn">{problem}</p>}
      <button
        type="button"
        disabled={busy}
        onClick={save}
        className="mt-3 h-11 w-full rounded-xl bg-brand text-[13px] font-bold text-white disabled:opacity-60"
      >
        {busy ? "Saving…" : saved ? "Saved ✓" : "Save pick-up hours"}
      </button>
    </section>
  );
}
