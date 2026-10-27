"use client";

// Mirrors business/new/activity/activity-form.tsx exactly, field for field —
// same inputs, same validation, same photo-upload flow. The only real
// differences: this one starts filled in with what's already there, and
// submits to updatePartnerActivity instead of addPartnerActivity. Category
// isn't editable here — see 013-partner-listing-edits.sql for why.

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  setPartnerActivityLocation,
  updatePartnerActivity,
  type ActivityDetail,
} from "@/lib/partner-register";
import { adminSetActivityLocation, adminUpdateActivity } from "@/lib/admin-listing-edit";
import PhotoGallery from "@/app/partner/(dashboard)/business/photo-gallery";
import ListingLocationFields from "@/app/partner/(dashboard)/business/listing-location-fields";
import { BackIcon } from "@/app/icons";

const inputClass =
  "h-12 w-full min-w-0 rounded-xl border border-line bg-surface px-3.5 text-[15px] font-semibold outline-none focus:border-brand";
const areaClass =
  "rounded-xl border border-line bg-surface px-3.5 py-3 text-[15px] font-semibold outline-none focus:border-brand";
const labelText = "text-[12px] font-bold text-muted";

export default function EditActivityForm({
  partnerId,
  activity,
  admin = false,
  backHref = "/partner/business",
}: {
  partnerId: string;
  activity: ActivityDetail;
  /** Rendered inside the admin console, editing on the partner's behalf —
   *  saves route to the admin_* RPCs and a live listing stays live. */
  admin?: boolean;
  backHref?: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(activity.name);
  const [summary, setSummary] = useState(activity.summary);
  const [about, setAbout] = useState(activity.about);
  const [area, setArea] = useState(activity.area);
  const [address, setAddress] = useState(activity.address);
  const [mapsUrl, setMapsUrl] = useState(activity.mapsUrl);
  const [priceRupees, setPriceRupees] = useState(String(activity.pricePaise / 100));
  const [photoPaths, setPhotoPaths] = useState<string[]>(activity.photoPaths);
  const [busy, setBusy] = useState<"photo" | "submit" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const price = Math.round(parseFloat(priceRupees || "0") * 100);
  const canSubmit =
    name.trim() !== "" &&
    priceRupees.trim() !== "" &&
    !isNaN(price) &&
    price >= 0 &&
    area.trim() !== "" &&
    mapsUrl.trim() !== "" &&
    !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy("submit");
    setProblem(null);

    const result = await (admin ? adminUpdateActivity : updatePartnerActivity)(activity.id, {
      name,
      summary,
      about,
      pricePaise: price,
      photoPaths,
    });

    if (!result.ok) {
      setProblem(result.message);
      setBusy(null);
      return;
    }

    // Location is operational (071) — its own RPC, and it doesn't bounce a
    // live listing back to review the way the content edit above can.
    const loc = await (admin ? adminSetActivityLocation : setPartnerActivityLocation)(activity.id, {
      area,
      address,
      mapsUrl,
    });
    if (!loc.ok) {
      setProblem(loc.message);
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

      <h2 className="font-display mt-3 text-[20px] font-bold tracking-tight">Edit activity</h2>

      <div className="mt-5 flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jet Ski Ride" className={inputClass} />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Short summary</span>
          <input
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="A fast 15-minute loop round the bay"
            className={inputClass}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={labelText}>About (shown on the full details page)</span>
          <textarea value={about} onChange={(e) => setAbout(e.target.value)} rows={3} className={areaClass} />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Price per person (₹)</span>
          <input
            type="number"
            inputMode="decimal"
            value={priceRupees}
            onChange={(e) => setPriceRupees(e.target.value)}
            placeholder="1500"
            className={inputClass}
          />
        </label>

        <PhotoGallery
          partnerId={partnerId}
          value={photoPaths}
          onChange={setPhotoPaths}
          onBusyChange={(b) => setBusy(b ? "photo" : null)}
        />

        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Area (required)</span>
          <input
            value={area}
            onChange={(e) => setArea(e.target.value)}
            placeholder="Aberdeen Bazaar"
            className={inputClass}
          />
          <p className="text-[11px] font-medium text-muted">
            Where it actually is — lets travellers pick something nearby first.
          </p>
        </label>

        <p className="text-[11px] font-medium text-muted">
          A map link is required below too — Directions needs it to send travellers to the right
          place.
        </p>

        <ListingLocationFields
          address={address}
          mapsUrl={mapsUrl}
          onAddressChange={setAddress}
          onMapsUrlChange={setMapsUrl}
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
