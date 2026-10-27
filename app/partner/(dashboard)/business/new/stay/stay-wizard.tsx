"use client";

// The "Add a stay" wizard — a clear, one-step-at-a-time walk through
// everything Andaman Go needs to list a homestay/guesthouse/villa/resort/
// hostel, modelled on what Airbnb, Booking.com and OYO all ask for at
// onboarding (property basics, location, room/capacity details, amenities
// and house rules, photos), but trimmed to what a small Andaman property
// actually needs — no rate-plan or multi-currency complexity.
//
// Each step is just React state, not a separate route — so Back/Next is
// instant and nothing is lost switching tabs. The property itself
// (add_partner_stay) is only created once, on the last step, after every
// earlier step has already been validated — a partial wizard never leaves a
// half-listed property behind.

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  addPartnerStay,
  setPartnerStayLocation,
  setStayRoomTypes,
  type StayPropertyType,
  type StayCancellationPolicy,
} from "@/lib/partner-register";
import { adminSetStayLocation, adminSetStayRoomTypes } from "@/lib/admin-listing-edit";
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
  newRoomTypeRow,
  roomTypeRowsToInput,
  roomTypeRowsValid,
  type RoomTypeRow,
} from "@/app/partner/(dashboard)/business/room-type-fields";
import { BackIcon, ChevronIcon, CheckIcon } from "@/app/icons";

const PROPERTY_TYPES: StayPropertyType[] = ["homestay", "guesthouse", "villa", "resort", "hostel", "hotel"];
const CANCELLATION_POLICIES: StayCancellationPolicy[] = ["flexible", "moderate", "strict"];

const STEPS = ["Basics", "Location", "Rooms", "Amenities & rules", "Photos", "Review"] as const;

const inputClass =
  "h-12 w-full min-w-0 rounded-xl border border-line bg-surface px-3.5 text-[15px] font-semibold outline-none focus:border-brand";
const areaClass =
  "rounded-xl border border-line bg-surface px-3.5 py-3 text-[15px] font-semibold outline-none focus:border-brand";
const labelText = "text-[12px] font-bold text-muted";

function timeToMins(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export default function StayWizard({
  partnerId,
  admin = false,
  backHref = "/partner/business",
}: {
  partnerId: string;
  /** An admin adding this for the business (136) — see activity-form.tsx. */
  admin?: boolean;
  backHref?: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);

  // Step 1 — basics
  const [name, setName] = useState("");
  const [propertyType, setPropertyType] = useState<StayPropertyType>("homestay");
  const [tagline, setTagline] = useState("");

  // Step 2 — location. Island is the partner's own explicit choice here —
  // never inherited from the business profile (100), since a partner
  // running stays on more than one island needs to say which one each
  // listing is actually on.
  const [islandSlug, setIslandSlug] = useState<string>(ISLANDS[0].slug);
  const [area, setArea] = useState("");
  const [address, setAddress] = useState("");
  const [mapsUrl, setMapsUrl] = useState("");

  // Step 3 — rooms
  const [rooms, setRooms] = useState<RoomTypeRow[]>(() => [newRoomTypeRow()]);

  // Step 4 — amenities & rules
  const [amenities, setAmenities] = useState<string[]>([]);
  const [houseRules, setHouseRules] = useState("");
  const [cancellationPolicy, setCancellationPolicy] = useState<StayCancellationPolicy>("moderate");
  const [checkIn, setCheckIn] = useState("14:00");
  const [checkOut, setCheckOut] = useState("11:00");
  const [about, setAbout] = useState("");

  // Step 5 — photos
  const [photoPaths, setPhotoPaths] = useState<string[]>([]);

  const [busy, setBusy] = useState<"photo" | "submit" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const toggleAmenity = (a: string) => {
    setAmenities((prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]));
  };

  const stepValid = (() => {
    switch (step) {
      case 0:
        return name.trim() !== "";
      case 1:
        return (
          area.trim() !== "" &&
          islandSlug.trim() !== "" &&
          address.trim() !== "" &&
          mapsUrl.trim() !== ""
        );
      case 2:
        return roomTypeRowsValid(rooms);
      case 3:
        return timeToMins(checkIn) !== timeToMins(checkOut);
      case 4:
        return photoPaths.length > 0;
      default:
        return true;
    }
  })();

  const next = () => {
    if (!stepValid || busy) return;
    setProblem(null);
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };
  const back = () => {
    if (busy) return;
    setProblem(null);
    setStep((s) => Math.max(0, s - 1));
  };

  const submit = async () => {
    setBusy("submit");
    setProblem(null);

    const where = admin ? "its edit page" : "the Business tab";
    const created = await addPartnerStay(
      {
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
      },
      admin ? partnerId : undefined,
    );
    if (!created.ok) {
      setProblem(created.message);
      setBusy(null);
      return;
    }

    const roomsSaved = await (admin ? adminSetStayRoomTypes : setStayRoomTypes)(
      created.stayId,
      roomTypeRowsToInput(rooms),
    );
    if (!roomsSaved.ok) {
      setProblem(`${roomsSaved.message} The property was saved — add room types from ${where}.`);
      setBusy(null);
      return;
    }

    if (address.trim() !== "" || mapsUrl.trim() !== "") {
      const loc = await (admin ? adminSetStayLocation : setPartnerStayLocation)(created.stayId, {
        address,
        mapsUrl,
      });
      if (!loc.ok) {
        setProblem(`${loc.message} The listing was saved — add its location from ${where}.`);
        setBusy(null);
        return;
      }
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

      <h2 className="font-display mt-3 text-[20px] font-bold tracking-tight">Add a stay</h2>

      {/* stepper */}
      <ol className="mt-4 flex items-center gap-1.5">
        {STEPS.map((label, i) => (
          <li key={label} className="flex flex-1 flex-col items-center gap-1">
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full text-[10.5px] font-bold ${
                i < step
                  ? "bg-brand text-white"
                  : i === step
                    ? "border-2 border-brand text-brand"
                    : "border border-line text-muted"
              }`}
            >
              {i < step ? <CheckIcon size={11} /> : i + 1}
            </span>
            <span className="hidden text-center text-[9.5px] font-bold text-muted sm:block">{label}</span>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-center text-[11.5px] font-bold text-muted sm:hidden">
        Step {step + 1} of {STEPS.length} · {STEPS[step]}
      </p>

      <div className="mt-5 flex flex-col gap-3">
        {step === 0 && (
          <>
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
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Sea Breeze Homestay"
                className={inputClass}
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className={labelText}>Tagline (optional)</span>
              <input
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                placeholder="Quiet garden stay, 5 minutes from the beach"
                className={inputClass}
              />
            </label>
          </>
        )}

        {step === 1 && (
          <>
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
              <span className="text-[11px] font-medium text-muted">
                Where the property actually is — this decides which island travellers find it
                under, so pick carefully.
              </span>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className={labelText}>Area</span>
              <input
                value={area}
                onChange={(e) => setArea(e.target.value)}
                placeholder="Govind Nagar, Havelock"
                className={inputClass}
              />
            </label>
            <ListingLocationFields
              address={address}
              mapsUrl={mapsUrl}
              onAddressChange={setAddress}
              onMapsUrlChange={setMapsUrl}
              required
            />
          </>
        )}

        {step === 2 && (
          <>
            <p className="text-[11.5px] font-medium text-muted">
              Add one row per kind of room. A single-room homestay just needs one.
            </p>
            <RoomTypeFields rows={rooms} onChange={setRooms} />
          </>
        )}

        {step === 3 && (
          <>
            <div className="flex flex-col gap-1.5">
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

            <div className="mt-1 grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5">
                <span className={labelText}>Check-in from</span>
                <input
                  type="time"
                  value={checkIn}
                  onChange={(e) => setCheckIn(e.target.value)}
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={labelText}>Check-out by</span>
                <input
                  type="time"
                  value={checkOut}
                  onChange={(e) => setCheckOut(e.target.value)}
                  className={inputClass}
                />
              </label>
            </div>
            {timeToMins(checkIn) === timeToMins(checkOut) && (
              <p className="text-[11.5px] font-medium text-warn">
                Check-in and check-out can&apos;t be the same time.
              </p>
            )}

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
              <span className={labelText}>House rules (optional)</span>
              <textarea
                value={houseRules}
                onChange={(e) => setHouseRules(e.target.value)}
                rows={3}
                placeholder="No smoking indoors, quiet hours after 10 PM, no pets"
                className={areaClass}
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className={labelText}>About (shown on the full details page)</span>
              <textarea value={about} onChange={(e) => setAbout(e.target.value)} rows={3} className={areaClass} />
            </label>
          </>
        )}

        {step === 4 && (
          <PhotoGallery
            partnerId={partnerId}
            value={photoPaths}
            onChange={setPhotoPaths}
            onBusyChange={(b) => setBusy(b ? "photo" : null)}
            allowVideo
            required
          />
        )}

        {step === 5 && (
          <div className="flex flex-col gap-3 rounded-xl border border-line bg-ground p-4">
            <div>
              <p className="text-[13.5px] font-bold">{name || "—"}</p>
              <p className="text-[12px] font-medium text-muted">
                {PROPERTY_TYPE_LABEL[propertyType]} · {area || "—"} ·{" "}
                {ISLANDS.find((isl) => isl.slug === islandSlug)?.name}
              </p>
            </div>
            <div className="border-t border-hairline pt-2.5">
              <p className={labelText}>Room types</p>
              <ul className="mt-1 flex flex-col gap-1">
                {rooms.map((r) => (
                  <li key={r.key} className="text-[12.5px] font-medium">
                    {r.name || "Untitled"} · ₹{r.nightlyRate || "0"}/night · sleeps {r.maxGuests} ·{" "}
                    {r.quantity} unit{r.quantity === "1" ? "" : "s"}
                  </li>
                ))}
              </ul>
            </div>
            <div className="border-t border-hairline pt-2.5">
              <p className={labelText}>Check-in / check-out</p>
              <p className="mt-1 text-[12.5px] font-medium">
                {checkIn} – {checkOut} · {CANCELLATION_LABEL[cancellationPolicy]}
              </p>
            </div>
            <div className="border-t border-hairline pt-2.5">
              <p className={labelText}>Photos</p>
              <p className="mt-1 text-[12.5px] font-medium">
                {photoPaths.length} added
              </p>
            </div>
          </div>
        )}

        {problem && <p className="text-[12.5px] font-medium text-warn">{problem}</p>}

        <div className="mt-2 flex gap-2.5">
          {step > 0 && (
            <button
              type="button"
              disabled={busy === "submit"}
              onClick={back}
              className="h-14 flex-1 rounded-2xl border border-line bg-surface text-[15px] font-bold text-ink disabled:opacity-50"
            >
              Back
            </button>
          )}
          {step < STEPS.length - 1 ? (
            <button
              type="button"
              disabled={!stepValid || busy === "photo"}
              onClick={next}
              className="flex h-14 flex-[2] items-center justify-center gap-1.5 rounded-2xl bg-brand text-[15px] font-bold text-white disabled:bg-line disabled:text-muted"
            >
              Next
              <ChevronIcon size={16} />
            </button>
          ) : (
            <button
              type="button"
              disabled={busy !== null}
              onClick={submit}
              className="h-14 flex-[2] rounded-2xl bg-brand text-[15px] font-bold text-white disabled:bg-line disabled:text-muted"
            >
              {busy === "submit" ? "Submitting…" : "Submit for review"}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
