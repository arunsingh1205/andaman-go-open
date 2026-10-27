"use client";

// The room-type editor for a stay (stay_room_types), shared by the "Add a
// stay" wizard (business/new/stay) and its edit form (business/edit/stay).
// A room type is the bookable unit: a name, how many guests/beds/baths it
// sleeps, a nightly rate, and how many identical units the property has
// (a single-room homestay is just one row with quantity 1). Saving the whole
// set is a bulk replace (setStayRoomTypes) — same operational discipline as
// a cab's routes: it does not send a live listing back to review.

import { CloseIcon, PlusIcon } from "@/app/icons";
import { AMENITY_LABEL, STAY_AMENITIES, type StayAmenity } from "@/lib/stays";

export type RoomTypeRow = {
  key: number;
  id?: string;
  code?: string;
  name: string;
  maxGuests: string;
  bedrooms: string;
  beds: string;
  bathrooms: string;
  nightlyRate: string;
  quantity: string;
  amenities: string[];
};

function nextKey(rows: RoomTypeRow[]): number {
  return rows.reduce((max, r) => Math.max(max, r.key), -1) + 1;
}

export function newRoomTypeRow(key = 0): RoomTypeRow {
  return {
    key,
    name: "",
    maxGuests: "2",
    bedrooms: "1",
    beds: "1",
    bathrooms: "1",
    nightlyRate: "",
    quantity: "1",
    amenities: [],
  };
}

export function roomTypeRowsFromDetail(
  roomTypes: {
    id: string;
    code: string;
    name: string;
    maxGuests: number;
    bedrooms: number;
    beds: number;
    bathrooms: number;
    nightlyRatePaise: number;
    quantity: number;
    amenities: string[];
  }[],
): RoomTypeRow[] {
  if (roomTypes.length === 0) return [newRoomTypeRow()];
  return roomTypes.map((r, i) => ({
    key: i,
    id: r.id,
    code: r.code,
    name: r.name,
    maxGuests: String(r.maxGuests),
    bedrooms: String(r.bedrooms),
    beds: String(r.beds),
    bathrooms: String(r.bathrooms),
    nightlyRate: String(r.nightlyRatePaise / 100),
    quantity: String(r.quantity),
    amenities: r.amenities,
  }));
}

export function roomTypeRowsToInput(rows: RoomTypeRow[]) {
  return rows.map((r) => ({
    code: r.code,
    name: r.name.trim(),
    maxGuests: parseInt(r.maxGuests || "0", 10),
    bedrooms: parseInt(r.bedrooms || "0", 10),
    beds: parseInt(r.beds || "0", 10),
    bathrooms: parseInt(r.bathrooms || "0", 10),
    nightlyRatePaise: Math.round(parseFloat(r.nightlyRate || "0") * 100),
    quantity: parseInt(r.quantity || "0", 10),
    amenities: r.amenities,
  }));
}

export function roomTypeRowsValid(rows: RoomTypeRow[]): boolean {
  if (rows.length === 0) return false;
  return rows.every((r) => {
    const maxGuests = parseInt(r.maxGuests || "0", 10);
    const quantity = parseInt(r.quantity || "0", 10);
    const rate = parseFloat(r.nightlyRate || "0");
    return r.name.trim() !== "" && maxGuests >= 1 && quantity >= 1 && rate >= 0;
  });
}

const inputClass =
  "h-11 w-full min-w-0 rounded-xl border border-line bg-surface px-3 text-[14px] font-semibold outline-none focus:border-brand";
const labelText = "text-[11.5px] font-bold text-muted";

export default function RoomTypeFields({
  rows,
  onChange,
}: {
  rows: RoomTypeRow[];
  onChange: (rows: RoomTypeRow[]) => void;
}) {
  const updateRow = (key: number, patch: Partial<RoomTypeRow>) => {
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const addRow = () => onChange([...rows, newRoomTypeRow(nextKey(rows))]);

  const removeRow = (key: number) => {
    if (rows.length > 1) onChange(rows.filter((r) => r.key !== key));
  };

  const toggleAmenity = (key: number, amenity: string) => {
    const row = rows.find((r) => r.key === key);
    if (!row) return;
    const has = row.amenities.includes(amenity);
    updateRow(key, {
      amenities: has ? row.amenities.filter((a) => a !== amenity) : [...row.amenities, amenity],
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {rows.map((row, i) => (
        <div key={row.key} className="rounded-xl border border-line bg-surface p-3.5">
          <div className="flex items-center justify-between">
            <span className="text-[11.5px] font-bold text-muted">
              {rows.length > 1 ? `Room type ${i + 1}` : "Room type"}
            </span>
            {rows.length > 1 && (
              <button
                type="button"
                onClick={() => removeRow(row.key)}
                aria-label="Remove this room type"
                className="text-muted"
              >
                <CloseIcon size={14} />
              </button>
            )}
          </div>

          <label className="mt-2 flex flex-col gap-1.5">
            <span className={labelText}>Room type name</span>
            <input
              value={row.name}
              onChange={(e) => updateRow(row.key, { name: e.target.value })}
              placeholder="Entire homestay, or Deluxe Double"
              className={inputClass}
            />
          </label>

          <div className="mt-2 grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className={labelText}>Max guests</span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                value={row.maxGuests}
                onChange={(e) => updateRow(row.key, { maxGuests: e.target.value })}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={labelText}>Nightly rate (₹)</span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                value={row.nightlyRate}
                onChange={(e) => updateRow(row.key, { nightlyRate: e.target.value })}
                placeholder="2500"
                className={inputClass}
              />
            </label>
          </div>

          <div className="mt-2 grid grid-cols-3 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className={labelText}>Bedrooms</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={row.bedrooms}
                onChange={(e) => updateRow(row.key, { bedrooms: e.target.value })}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={labelText}>Beds</span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                value={row.beds}
                onChange={(e) => updateRow(row.key, { beds: e.target.value })}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={labelText}>Bathrooms</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={row.bathrooms}
                onChange={(e) => updateRow(row.key, { bathrooms: e.target.value })}
                className={inputClass}
              />
            </label>
          </div>

          <label className="mt-2 flex flex-col gap-1.5">
            <span className={labelText}>How many identical units do you have?</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              value={row.quantity}
              onChange={(e) => updateRow(row.key, { quantity: e.target.value })}
              className={inputClass}
            />
            <span className="text-[11px] font-medium text-muted">
              A single-room homestay is 1. A guesthouse with three identical AC doubles is 3.
            </span>
          </label>

          <div className="mt-2.5 flex flex-col gap-1.5">
            <span className={labelText}>Room amenities</span>
            <div className="flex flex-wrap gap-1.5">
              {STAY_AMENITIES.map((a) => {
                const on = row.amenities.includes(a);
                return (
                  <button
                    key={a}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleAmenity(row.key, a)}
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
        </div>
      ))}

      <button
        type="button"
        onClick={addRow}
        className="flex h-10 items-center justify-center gap-1.5 rounded-xl border border-dashed border-line text-[12.5px] font-bold text-muted"
      >
        <PlusIcon size={12} />
        Add another room type
      </button>
    </div>
  );
}
