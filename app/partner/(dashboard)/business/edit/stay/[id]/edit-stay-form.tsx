"use client";

// Mirrors business/new/stay's wizard fields, but as one consolidated page —
// same discipline as edit-restaurant-form.tsx: prefilled from what's already
// on the row, editing content bounces a live listing back for a quick
// recheck, but room types (like a cab's routes) are operational and don't.

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  setPartnerStayLocation,
  updatePartnerStay,
  setStayRoomTypes,
  type StayDetail,
  type StayPropertyType,
  type StayCancellationPolicy,
} from "@/lib/partner-register";
import {
  adminSetStayLocation,
  adminUpdateStay,
  adminSetStayRoomTypes,
} from "@/lib/admin-listing-edit";
import {
  AMENITY_LABEL,
  PROPERTY_TYPE_LABEL,
  CANCELLATION_LABEL,
  STAY_AMENITIES,
  type StayAmenity,
} from "@/lib/stays";
import { ISLANDS } from "@/lib/islands";
import PhotoGallery from "@/app/partner/(dashboard)/business/photo-gallery";
import ListingLocationFields from "@/app/partner/(dashboard)/business/listing-location-fields";
import RoomTypeFields, {
  roomTypeRowsFromDetail,
  roomTypeRowsToInput,
  roomTypeRowsValid,
  type RoomTypeRow,
} from "@/app/partner/(dashboard)/business/room-type-fields";
import { BackIcon } from "@/app/icons";

const PROPERTY_TYPES: StayPropertyType[] = ["homestay", "guesthouse", "villa", "resort", "hostel", "hotel"];
const CANCELLATION_POLICIES: StayCancellationPolicy[] = ["flexible", "moderate", "strict"];

const inputClass =
  "h-12 w-full min-w-0 rounded-xl border border-line bg-surface px-3.5 text-[15px] font-semibold outline-none focus:border-brand";
const areaClass =
  "rounded-xl border border-line bg-surface px-3.5 py-3 text-[15px] font-semibold outline-none focus:border-brand";
const labelText = "text-[12px] font-bold text-muted";

function timeToMins(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
function minsToTime(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export default function EditStayForm({
  partnerId,
  stay,
  admin = false,
  backHref = "/partner/business",
}: {
  partnerId: string;
  stay: StayDetail;
  admin?: boolean;
  backHref?: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(stay.name);
  const [islandSlug, setIslandSlug] = useState(stay.islandSlug);
  const [propertyType, setPropertyType] = useState<StayPropertyType>(stay.propertyType);
  const [area, setArea] = useState(stay.area);
  const [tagline, setTagline] = useState(stay.tagline);
  const [about, setAbout] = useState(stay.about);
  const [amenities, setAmenities] = useState<string[]>(stay.amenities);
  const [houseRules, setHouseRules] = useState(stay.houseRules);
  const [cancellationPolicy, setCancellationPolicy] = useState<StayCancellationPolicy>(
    stay.cancellationPolicy,
  );
  const [checkIn, setCheckIn] = useState(minsToTime(stay.checkInMins));
  const [checkOut, setCheckOut] = useState(minsToTime(stay.checkOutMins));
  const [address, setAddress] = useState(stay.address);
  const [mapsUrl, setMapsUrl] = useState(stay.mapsUrl);
  const [photoPaths, setPhotoPaths] = useState<string[]>(stay.photoPaths);
  const [rooms, setRooms] = useState<RoomTypeRow[]>(() => roomTypeRowsFromDetail(stay.roomTypes));
  const [busy, setBusy] = useState<"photo" | "submit" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const toggleAmenity = (a: string) => {
    setAmenities((prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]));
  };

  const canSubmit =
    name.trim() !== "" &&
    area.trim() !== "" &&
    address.trim() !== "" &&
    mapsUrl.trim() !== "" &&
    roomTypeRowsValid(rooms) &&
    timeToMins(checkIn) !== timeToMins(checkOut) &&
    photoPaths.length > 0 &&
    !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy("submit");
    setProblem(null);

    const result = await (admin ? adminUpdateStay : updatePartnerStay)(stay.id, {
      name,
      islandSlug,
      propertyType,
      area,
      tagline,
      about,
      amenities,
      houseRules,
      cancellationPolicy,
      checkInMins: timeToMins(checkIn),
      checkOutMins: timeToMins(checkOut),
      photoPaths,
    });
    if (!result.ok) {
      setProblem(result.message);
      setBusy(null);
      return;
    }

    const roomsSaved = await (admin ? adminSetStayRoomTypes : setStayRoomTypes)(
      stay.id,
      roomTypeRowsToInput(rooms),
    );
    if (!roomsSaved.ok) {
      setProblem(roomsSaved.message);
      setBusy(null);
      return;
    }

    // Location is operational — its own RPC, doesn't bounce a live listing
    // back to review the way the content edit above can.
    const loc = await (admin ? adminSetStayLocation : setPartnerStayLocation)(stay.id, {
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

      <h2 className="font-display mt-3 text-[20px] font-bold tracking-tight">Edit stay</h2>

      <div className="mt-5 flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Property type</span>
          <select
            value={propertyType}
            onChange={(e) => setPropertyType(e.target.value as StayPropertyType)}
            className={inputClass}
          >
            {PROPERTY_TYPES.map((t) => (
              <option key={t} value={t}>
                {PROPERTY_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Property name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Tagline (optional)</span>
          <input value={tagline} onChange={(e) => setTagline(e.target.value)} className={inputClass} />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Island</span>
          <select
            value={islandSlug}
            onChange={(e) => setIslandSlug(e.target.value)}
            className={inputClass}
          >
            {ISLANDS.map((isl) => (
              <option key={isl.slug} value={isl.slug}>
                {isl.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Area</span>
          <input value={area} onChange={(e) => setArea(e.target.value)} className={inputClass} />
        </label>

        <div className="flex flex-col gap-1.5 border-t border-hairline pt-4">
          <span className={labelText}>Amenities (shared / property-wide)</span>
          <div className="flex flex-wrap gap-1.5">
            {STAY_AMENITIES.map((a) => {
              const on = amenities.includes(a);
              return (
                <button
                  key={a}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleAmenity(a)}
                  className={`h-8 rounded-full border px-3 text-[11.5px] font-semibold ${
                    on ? "border-brand bg-brand text-white" : "border-line bg-surface text-muted"
                  }`}
                >
                  {AMENITY_LABEL[a as StayAmenity]}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className={labelText}>Check-in from</span>
            <input type="time" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelText}>Check-out by</span>
            <input type="time" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} className={inputClass} />
          </label>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Cancellation policy</span>
          <select
            value={cancellationPolicy}
            onChange={(e) => setCancellationPolicy(e.target.value as StayCancellationPolicy)}
            className={inputClass}
          >
            {CANCELLATION_POLICIES.map((p) => (
              <option key={p} value={p}>
                {CANCELLATION_LABEL[p]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={labelText}>House rules</span>
          <textarea value={houseRules} onChange={(e) => setHouseRules(e.target.value)} rows={3} className={areaClass} />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={labelText}>About (shown on the full details page)</span>
          <textarea value={about} onChange={(e) => setAbout(e.target.value)} rows={3} className={areaClass} />
        </label>

        <PhotoGallery
          partnerId={partnerId}
          value={photoPaths}
          onChange={setPhotoPaths}
          onBusyChange={(b) => setBusy(b ? "photo" : null)}
          allowVideo
          required
        />

        <ListingLocationFields
          address={address}
          mapsUrl={mapsUrl}
          onAddressChange={setAddress}
          onMapsUrlChange={setMapsUrl}
          required
        />

        <div className="flex flex-col gap-1.5 border-t border-hairline pt-4">
          <span className={labelText}>Room types</span>
          <p className="text-[11.5px] font-medium text-muted">
            Changing these won&apos;t send the listing back for review — they&apos;re operational,
            like a cab&apos;s routes.
          </p>
          <div className="mt-1.5">
            <RoomTypeFields rows={rooms} onChange={setRooms} />
          </div>
        </div>

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
