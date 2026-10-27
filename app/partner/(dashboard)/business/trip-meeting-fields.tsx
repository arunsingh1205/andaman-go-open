"use client";

// The "Meeting point" editor for a day trip, shared by the new-trip form
// (business/new/trip) and the edit form (business/edit/trip/[id], which also
// backs the admin edit) — same split as trip-schedule-fields.tsx.
//
// A trip either meets travellers at a fixed spot (a free-text address plus an
// optional Google Maps pin) or the host collects each one from their
// accommodation. In hotel-pickup mode there is no address to type — the
// traveller enters where they're staying when they book (see trips.meet_at_hotel
// / trips.maps_url / booking_items.pickup_address, migration 076).
//
// Controlled: the parent form owns meetAtHotel + meetPoint + mapsUrl.

const inputClass =
  "h-12 w-full min-w-0 rounded-xl border border-line bg-surface px-3.5 text-[15px] font-semibold outline-none focus:border-brand";
const labelText = "text-[12px] font-bold text-muted";

type MeetingValue = { meetAtHotel: boolean; meetPoint: string; mapsUrl: string };

/** Whether the meeting-point part of a trip form is complete. */
export function meetingValid(meetAtHotel: boolean, meetPoint: string): boolean {
  return meetAtHotel || meetPoint.trim() !== "";
}

export default function TripMeetingFields({
  meetAtHotel,
  meetPoint,
  mapsUrl,
  onChange,
}: MeetingValue & {
  onChange: (next: MeetingValue) => void;
}) {
  const current: MeetingValue = { meetAtHotel, meetPoint, mapsUrl };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <span className={labelText}>Meeting point</span>
        <div className="flex gap-1.5">
          {(
            [
              [false, "Fixed meeting point"],
              [true, "Hotel pickup"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={label}
              type="button"
              onClick={() => onChange({ ...current, meetAtHotel: value })}
              className={`h-9 flex-1 rounded-lg px-3 text-[12.5px] font-bold ${
                meetAtHotel === value ? "bg-brand text-white" : "border border-line bg-surface text-muted"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {meetAtHotel ? (
        <p className="text-[11.5px] font-medium text-muted">
          You&apos;ll collect each traveller from where they&apos;re staying — they enter their
          hotel and area when they book, and it shows on the booking.
        </p>
      ) : (
        <>
          <input
            value={meetPoint}
            onChange={(e) => onChange({ ...current, meetPoint: e.target.value })}
            placeholder="Main jetty"
            className={inputClass}
          />
          <label className="flex flex-col gap-1.5">
            <span className={labelText}>Google Maps link (optional)</span>
            <input
              value={mapsUrl}
              onChange={(e) => onChange({ ...current, mapsUrl: e.target.value })}
              placeholder="Paste a Google Maps share link"
              className={inputClass}
            />
            <span className="text-[11.5px] font-medium text-muted">
              Open the spot in Google Maps, tap Share, and paste the link — travellers get a
              &ldquo;Directions&rdquo; button.
            </span>
          </label>
        </>
      )}
    </div>
  );
}
