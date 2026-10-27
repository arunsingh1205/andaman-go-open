"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  addPartnerActivity,
  setPartnerActivityLocation,
  setPartnerActivityMode,
  setPartnerActivitySchedule,
  type ActivityCategory,
} from "@/lib/partner-register";
import {
  adminSetActivityLocation,
  adminSetActivityMode,
  adminSetActivitySchedule,
} from "@/lib/admin-listing-edit";
import PhotoGallery from "@/app/partner/(dashboard)/business/photo-gallery";
import ListingLocationFields from "@/app/partner/(dashboard)/business/listing-location-fields";
import ActivityScheduleFields, {
  activityRowsToSlots,
  activityRowsValid,
  newActivityRow,
  type ActivityRow,
  type ScheduleMode,
} from "@/app/partner/(dashboard)/business/activity-schedule-fields";
import { BackIcon } from "@/app/icons";

const CATEGORY_OPTIONS: { value: ActivityCategory; label: string }[] = [
  { value: "scuba", label: "Scuba diving" },
  { value: "seawalk", label: "Sea walk" },
  { value: "snorkel", label: "Snorkelling" },
  { value: "water", label: "Water sports (jet ski, banana ride, etc.)" },
  { value: "stargazing", label: "Stargazing" },
];

const inputClass =
  "h-12 w-full min-w-0 rounded-xl border border-line bg-surface px-3.5 text-[15px] font-semibold outline-none focus:border-brand";
const areaClass =
  "rounded-xl border border-line bg-surface px-3.5 py-3 text-[15px] font-semibold outline-none focus:border-brand";
const labelText = "text-[12px] font-bold text-muted";

export default function ActivityForm({
  partnerId,
  admin = false,
  backHref = "/partner/business",
}: {
  partnerId: string;
  /** An admin adding this for the business (136): saves route to the
   *  admin_* twins, the listing still lands as "waiting" for approval. */
  admin?: boolean;
  backHref?: string;
}) {
  const router = useRouter();
  const [category, setCategory] = useState<ActivityCategory>("water");
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [about, setAbout] = useState("");
  const [area, setArea] = useState("");
  const [address, setAddress] = useState("");
  const [mapsUrl, setMapsUrl] = useState("");
  const [priceRupees, setPriceRupees] = useState("");
  const [photoPaths, setPhotoPaths] = useState<string[]>([]);
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>("window");
  const [rows, setRows] = useState<ActivityRow[]>(() => [newActivityRow(0, "window")]);
  // Set once the activity row exists — if saving its schedule then fails, a
  // retry only re-sends the schedule instead of creating a second activity.
  const [activityId, setActivityId] = useState<string | null>(null);
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
    activityRowsValid(rows) &&
    !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy("submit");
    setProblem(null);

    let id = activityId;
    if (!id) {
      const result = await addPartnerActivity(
        { category, name, summary, about, pricePaise: price, photoPaths },
        admin ? partnerId : undefined,
      );
      if (!result.ok) {
        setProblem(result.message);
        setBusy(null);
        return;
      }
      id = result.activityId;
      setActivityId(id);

      // New activities are created in "window" mode by default (090) — only
      // switch it when the partner picked fixed departure times instead.
      if (scheduleMode === "fixed") {
        const modeResult = await (admin ? adminSetActivityMode : setPartnerActivityMode)(id, "fixed");
        if (!modeResult.ok) {
          setProblem(`${modeResult.message} Your listing was saved — fix its schedule mode from the Business tab.`);
          setBusy(null);
          return;
        }
      }
    }

    const loc = await (admin ? adminSetActivityLocation : setPartnerActivityLocation)(id, {
      area,
      address,
      mapsUrl,
    });
    if (!loc.ok) {
      setProblem(
        `${loc.message} The listing was saved — add its area and map link from ${admin ? "its edit page" : "the Business tab"}.`,
      );
      setBusy(null);
      return;
    }

    const schedule = await (admin ? adminSetActivitySchedule : setPartnerActivitySchedule)(
      id,
      activityRowsToSlots(rows),
    );
    if (!schedule.ok) {
      setProblem(
        `${schedule.message} The listing was saved — add the times from ${admin ? "its edit page" : "the Business tab"}.`,
      );
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

      <h2 className="font-display mt-3 text-[20px] font-bold tracking-tight">Add an activity</h2>

      <div className="mt-5 flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Category</span>
          <select value={category} onChange={(e) => setCategory(e.target.value as ActivityCategory)} className={inputClass}>
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>

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

        <div className="flex flex-col gap-1.5 border-t border-hairline pt-4">
          <span className={labelText}>When can travellers book this?</span>
          <p className="text-[11.5px] font-medium text-muted">
            You can fine-tune the hours and capacity later under Business — it won&apos;t need another
            review.
          </p>
          <div className="mt-1 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setScheduleMode("window");
                setRows([newActivityRow(0, "window")]);
              }}
              className={`h-9 flex-1 rounded-xl text-[12.5px] font-bold ${
                scheduleMode === "window" ? "bg-brand text-white" : "border border-line bg-surface text-muted"
              }`}
            >
              A window, e.g. 9 AM–2 PM
            </button>
            <button
              type="button"
              onClick={() => {
                setScheduleMode("fixed");
                setRows([newActivityRow(0, "fixed")]);
              }}
              className={`h-9 flex-1 rounded-xl text-[12.5px] font-bold ${
                scheduleMode === "fixed" ? "bg-brand text-white" : "border border-line bg-surface text-muted"
              }`}
            >
              Fixed departure times
            </button>
          </div>
          <div className="mt-1.5">
            <ActivityScheduleFields rows={rows} onChange={setRows} mode={scheduleMode} />
          </div>
        </div>

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
