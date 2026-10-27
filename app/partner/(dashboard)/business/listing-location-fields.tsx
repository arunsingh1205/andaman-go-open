"use client";

// The optional per-listing address + Google Maps link, shared by the four
// restaurant / activity forms (new + edit). The business profile keeps the
// headquarters address (partner onboarding); this is the exact spot for THIS
// listing — so "Directions" on a booking lands on the branch the traveller
// booked, not another one the same business runs. Left blank, a listing falls
// back to the business profile (071-listing-locations.sql).
//
// Controlled: the parent owns both strings. Saving is operational — it never
// sends a live listing back for review, the same way the schedule editors
// don't (071).

const inputClass =
  "h-12 w-full min-w-0 rounded-xl border border-line bg-surface px-3.5 text-[15px] font-semibold outline-none focus:border-brand";
const areaClass =
  "rounded-xl border border-line bg-surface px-3.5 py-3 text-[15px] font-semibold outline-none focus:border-brand";
const labelText = "text-[12px] font-bold text-muted";

export default function ListingLocationFields({
  address,
  mapsUrl,
  onAddressChange,
  onMapsUrlChange,
  required = false,
}: {
  address: string;
  mapsUrl: string;
  onAddressChange: (value: string) => void;
  onMapsUrlChange: (value: string) => void;
  /** Stays: a traveller has to be able to find the property, so both fields are required here. */
  required?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-hairline pt-4">
      <div className="flex flex-col gap-1">
        <span className={labelText}>Where this listing is</span>
        <p className="text-[11.5px] font-medium text-muted">
          {required
            ? "This is what “Directions” points a traveller to — required so they can actually find the property."
            : "Leave blank if it's the same as your business address. If this branch is somewhere else, its own address goes here — this is what “Directions” points a traveller to."}
        </p>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className={labelText}>Address{!required && " (optional)"}</span>
        <textarea
          value={address}
          onChange={(e) => onAddressChange(e.target.value)}
          rows={2}
          placeholder="Beach No. 3, Govind Nagar, Havelock"
          className={areaClass}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={labelText}>Google Maps link{!required && " (optional)"}</span>
        <input
          value={mapsUrl}
          onChange={(e) => onMapsUrlChange(e.target.value)}
          placeholder="Paste a Google Maps share link"
          className={inputClass}
        />
        <span className="text-[11.5px] font-medium text-muted">
          Open this spot in Google Maps, tap Share, and paste the link here.
        </span>
      </label>
    </div>
  );
}
