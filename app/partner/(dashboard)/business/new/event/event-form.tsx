"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { addPartnerEvent, type EventAgeRestriction, type EventGenre } from "@/lib/partner-register";
import PhotoGallery from "@/app/partner/(dashboard)/business/photo-gallery";
import EventRecurrenceFields, {
  emptyEventRecurrence,
  eventRecurrenceToArgs,
  eventRecurrenceValid,
  type EventRecurrence,
} from "@/app/partner/(dashboard)/business/event-recurrence-fields";
import TicketTypesEditor, {
  cheapestPaise,
  ticketsValid,
  toTicketInputs,
  type TicketDraft,
} from "@/app/partner/(dashboard)/business/ticket-types-editor";
import { ISLANDS } from "@/lib/islands";
import { BackIcon } from "@/app/icons";

const GENRE_OPTIONS: { value: EventGenre; label: string }[] = [
  { value: "dj", label: "DJ night" },
  { value: "live", label: "Live music" },
  { value: "bonfire", label: "Bonfire" },
  { value: "karaoke", label: "Karaoke" },
  { value: "comedy", label: "Comedy show" },
  { value: "drama", label: "Drama / theatre" },
  { value: "festival", label: "Tourism festival" },
  { value: "carnival", label: "Carnival" },
  { value: "cruise", label: "Dinner cruise" },
];

/** Some events are booked because of who's on: a DJ night, a gig, a comedy
 *  set, a play. A bonfire, karaoke, festival, carnival, or dinner cruise is
 *  the event itself, so those don't ask. Each performer-led type gets its
 *  own field label and example. */
const PERFORMER_FIELD: Partial<Record<EventGenre, { label: string; placeholder: string }>> = {
  dj: { label: "DJ / lineup", placeholder: "DJ Nyx" },
  live: { label: "Artist or band", placeholder: "The Reef Band" },
  comedy: { label: "Comedian / lineup", placeholder: "Aditi Mittal" },
  drama: { label: "Theatre company / play", placeholder: "Island Players — 'The Tempest'" },
};
const GENRES_NEEDING_PERFORMER = Object.keys(PERFORMER_FIELD) as EventGenre[];

const AGE_OPTIONS: { value: EventAgeRestriction; label: string }[] = [
  { value: "all-ages", label: "All ages" },
  { value: "18+", label: "18+" },
  { value: "21+", label: "21+" },
];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function timeToMins(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

const inputClass =
  "h-12 w-full min-w-0 rounded-xl border border-line bg-surface px-3.5 text-[15px] font-semibold outline-none focus:border-brand";
const areaClass =
  "rounded-xl border border-line bg-surface px-3.5 py-3 text-[15px] font-semibold outline-none focus:border-brand";
const labelText = "text-[12px] font-bold text-muted";

const KNOWN_ISLAND = (slug: string) =>
  ISLANDS.some((i) => i.slug === slug) ? slug : ISLANDS[0].slug;

export default function EventForm({
  partnerId,
  defaultIslandSlug,
  admin = false,
  backHref = "/partner/business",
}: {
  partnerId: string;
  defaultIslandSlug: string;
  /** An admin adding this for the business (136) — see activity-form.tsx. */
  admin?: boolean;
  backHref?: string;
}) {
  const router = useRouter();
  const [genre, setGenre] = useState<EventGenre>("dj");
  const [name, setName] = useState("");
  const [venue, setVenue] = useState("");
  const [area, setArea] = useState("");
  const [islandSlug, setIslandSlug] = useState(KNOWN_ISLAND(defaultIslandSlug));
  const [mapsUrl, setMapsUrl] = useState("");
  const [onDate, setOnDate] = useState(todayIso());
  const [recurrence, setRecurrence] = useState<EventRecurrence>(emptyEventRecurrence());
  const [time, setTime] = useState("19:00");
  const [endTime, setEndTime] = useState("");
  const [entryRupees, setEntryRupees] = useState("");
  const [capacity, setCapacity] = useState("");
  const [about, setAbout] = useState("");
  const [ageRestriction, setAgeRestriction] = useState<EventAgeRestriction>("all-ages");
  const [performer, setPerformer] = useState("");
  const [photoPaths, setPhotoPaths] = useState<string[]>([]);
  const [tickets, setTickets] = useState<TicketDraft[]>([]);
  const [busy, setBusy] = useState<"photo" | "submit" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const needsPerformer = GENRES_NEEDING_PERFORMER.includes(genre);
  const hasTickets = tickets.length > 0;
  const entryPaise = hasTickets
    ? cheapestPaise(tickets)
    : Math.round(parseFloat(entryRupees || "0") * 100);
  const capacityNum = capacity.trim() === "" ? null : parseInt(capacity, 10);
  const canSubmit =
    name.trim() !== "" &&
    venue.trim() !== "" &&
    onDate !== "" &&
    eventRecurrenceValid(recurrence, onDate) &&
    (hasTickets ? ticketsValid(tickets) : entryRupees.trim() !== "") &&
    !isNaN(entryPaise) &&
    entryPaise >= 0 &&
    (capacityNum === null || capacityNum >= 1) &&
    (!needsPerformer || performer.trim() !== "") &&
    !busy;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy("submit");
    setProblem(null);

    const result = await addPartnerEvent(
      {
        genre,
        name,
        venue,
        area,
        islandSlug,
        mapsUrl,
        onDate,
        timeMins: timeToMins(time),
        endTimeMins: endTime === "" ? null : timeToMins(endTime),
        entryPaise,
        capacity: capacityNum,
        about,
        ageRestriction,
        performer,
        photoPaths,
        tickets: toTicketInputs(tickets),
        ...eventRecurrenceToArgs(recurrence),
      },
      admin ? partnerId : undefined,
    );

    if (!result.ok) {
      setProblem(result.message);
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

      <h2 className="font-display mt-3 text-[20px] font-bold tracking-tight">Add an event</h2>

      <div className="mt-5 flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Type</span>
          <select value={genre} onChange={(e) => setGenre(e.target.value as EventGenre)} className={inputClass}>
            {GENRE_OPTIONS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Event name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full Moon Party" className={inputClass} />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Venue</span>
          <input value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="Beach No. 7" className={inputClass} />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Island</span>
          <select value={islandSlug} onChange={(e) => setIslandSlug(e.target.value)} className={inputClass}>
            {ISLANDS.map((i) => (
              <option key={i.slug} value={i.slug}>
                {i.full}
              </option>
            ))}
          </select>
          <span className="text-[11px] leading-relaxed font-medium text-muted">
            Which island this event is on — set it per listing if you host in more than one place.
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Area (optional)</span>
          <input value={area} onChange={(e) => setArea(e.target.value)} placeholder="Havelock" className={inputClass} />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Google Maps link (optional)</span>
          <input
            type="url"
            inputMode="url"
            value={mapsUrl}
            onChange={(e) => setMapsUrl(e.target.value)}
            placeholder="https://maps.app.goo.gl/…"
            className={inputClass}
          />
          <span className="text-[11px] leading-relaxed font-medium text-muted">
            Paste a Maps pin for the exact venue — travellers get a Directions button to it.
          </span>
        </label>

        {needsPerformer && (
          <label className="flex flex-col gap-1.5">
            <span className={labelText}>{PERFORMER_FIELD[genre]?.label ?? "Who's performing"}</span>
            <input
              value={performer}
              onChange={(e) => setPerformer(e.target.value)}
              placeholder={PERFORMER_FIELD[genre]?.placeholder}
              className={inputClass}
            />
          </label>
        )}

        <label className="flex flex-col gap-1.5">
          <span className={labelText}>Age restriction</span>
          <select
            value={ageRestriction}
            onChange={(e) => setAgeRestriction(e.target.value as EventAgeRestriction)}
            className={inputClass}
          >
            {AGE_OPTIONS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
          <span className="text-[11px] leading-relaxed font-medium text-muted">
            Kids 3 and under always go free and don&apos;t count toward capacity, whatever you
            choose here.
          </span>
        </label>

        <div className="flex gap-3">
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className={labelText}>Date</span>
            <input
              type="date"
              min={todayIso()}
              value={onDate}
              onChange={(e) => setOnDate(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className={labelText}>Start time</span>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={inputClass} />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className={labelText}>End time — optional</span>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className={inputClass}
            />
          </label>
        </div>

        <EventRecurrenceFields recurrence={recurrence} onChange={setRecurrence} onDate={onDate} />

        <TicketTypesEditor value={tickets} onChange={setTickets} />

        <div className="flex gap-3">
          {!hasTickets && (
            <label className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className={labelText}>Entry price per person (₹)</span>
              <input
                type="number"
                inputMode="decimal"
                value={entryRupees}
                onChange={(e) => setEntryRupees(e.target.value)}
                placeholder="500"
                className={inputClass}
              />
            </label>
          )}
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className={labelText}>Capacity (people) — optional</span>
            <input
              type="number"
              inputMode="numeric"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              placeholder="Leave blank for no limit"
              className={inputClass}
            />
          </label>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className={labelText}>About (shown on the full details page)</span>
          <textarea value={about} onChange={(e) => setAbout(e.target.value)} rows={3} className={areaClass} />
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
          {busy === "submit" ? "Adding…" : "Submit for review"}
        </button>
      </div>
    </>
  );
}
