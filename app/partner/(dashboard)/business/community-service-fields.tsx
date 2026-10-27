"use client";

// The Community Service organiser brief — every field on a community_services
// row, shared by the "new" and "edit" forms (business/new/community and
// business/edit/community/[id]) the same way ListingLocationFields backs the
// four restaurant/activity forms.
//
// Controlled: the parent owns the `draft` object and the helpers here
// (validation, the shape the add/update RPC wants) work off it.

import { ISLANDS } from "@/lib/islands";
import type { CommunityServiceInput } from "@/lib/partner-register";
import PhotoGallery from "@/app/partner/(dashboard)/business/photo-gallery";

export type CommunityDraft = {
  name: string;
  organizerName: string;
  about: string;
  islandSlug: string;
  mapsUrl: string;
  date: string;
  time: string;
  /** Approximate end time — optional, descriptive only. */
  endTime: string;
  meetingPoint: string;
  whatToBring: string;
  safetyNotes: string;
  minAge: string;
  maxAge: string;
  contactName: string;
  contactPhone: string;
  whatsappGroupUrl: string;
  photoPaths: string[];
};

export function emptyCommunityDraft(islandSlug: string): CommunityDraft {
  return {
    name: "",
    organizerName: "",
    about: "",
    islandSlug: ISLANDS.some((i) => i.slug === islandSlug) ? islandSlug : ISLANDS[0].slug,
    mapsUrl: "",
    date: new Date().toISOString().slice(0, 10),
    time: "07:00",
    endTime: "",
    meetingPoint: "",
    whatToBring: "",
    safetyNotes: "",
    minAge: "",
    maxAge: "",
    contactName: "",
    contactPhone: "",
    whatsappGroupUrl: "",
    photoPaths: [],
  };
}

export function communityDraftFrom(input: CommunityServiceInput): CommunityDraft {
  return {
    name: input.name,
    organizerName: input.organizerName,
    about: input.about,
    islandSlug: ISLANDS.some((i) => i.slug === input.islandSlug) ? input.islandSlug : ISLANDS[0].slug,
    mapsUrl: input.mapsUrl,
    date: input.onDate,
    time: minsToTime(input.timeMins),
    endTime: input.endTimeMins != null ? minsToTime(input.endTimeMins) : "",
    meetingPoint: input.meetingPoint,
    whatToBring: input.whatToBring,
    safetyNotes: input.safetyNotes,
    minAge: input.minAge == null ? "" : String(input.minAge),
    maxAge: input.maxAge == null ? "" : String(input.maxAge),
    contactName: input.contactName,
    contactPhone: input.contactPhone,
    whatsappGroupUrl: input.whatsappGroupUrl,
    photoPaths: input.photoPaths,
  };
}

function timeToMins(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function minsToTime(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const ageOrNull = (raw: string): number | null => {
  const n = parseInt(raw, 10);
  return raw.trim() === "" || isNaN(n) ? null : n;
};

/** The shape addPartnerCommunityService / updatePartnerCommunityService want. */
export function communityDraftToInput(draft: CommunityDraft): CommunityServiceInput {
  return {
    name: draft.name.trim(),
    organizerName: draft.organizerName.trim(),
    about: draft.about.trim(),
    islandSlug: draft.islandSlug,
    mapsUrl: draft.mapsUrl.trim(),
    onDate: draft.date,
    timeMins: timeToMins(draft.time),
    endTimeMins: draft.endTime === "" ? null : timeToMins(draft.endTime),
    meetingPoint: draft.meetingPoint.trim(),
    whatToBring: draft.whatToBring.trim(),
    safetyNotes: draft.safetyNotes.trim(),
    minAge: ageOrNull(draft.minAge),
    maxAge: ageOrNull(draft.maxAge),
    contactName: draft.contactName.trim(),
    contactPhone: draft.contactPhone.trim(),
    whatsappGroupUrl: draft.whatsappGroupUrl.trim(),
    photoPaths: draft.photoPaths,
  };
}

export function communityDraftValid(draft: CommunityDraft): boolean {
  const min = ageOrNull(draft.minAge);
  const max = ageOrNull(draft.maxAge);
  return (
    draft.name.trim() !== "" &&
    draft.organizerName.trim() !== "" &&
    draft.date !== "" &&
    draft.time !== "" &&
    draft.meetingPoint.trim() !== "" &&
    draft.contactName.trim() !== "" &&
    draft.contactPhone.trim() !== "" &&
    (min === null || (min >= 0 && min <= 120)) &&
    (max === null || (max >= 0 && max <= 120)) &&
    (min === null || max === null || max >= min)
  );
}

const inputClass =
  "h-12 w-full min-w-0 rounded-xl border border-line bg-surface px-3.5 text-[15px] font-semibold outline-none focus:border-brand";
const areaClass =
  "rounded-xl border border-line bg-surface px-3.5 py-3 text-[15px] font-semibold outline-none focus:border-brand";
const labelText = "text-[12px] font-bold text-muted";
const hintText = "text-[11px] leading-relaxed font-medium text-muted";

export default function CommunityServiceFields({
  draft,
  onChange,
  partnerId,
  onBusyChange,
}: {
  draft: CommunityDraft;
  onChange: (draft: CommunityDraft) => void;
  partnerId: string;
  onBusyChange?: (busy: boolean) => void;
}) {
  const set = (patch: Partial<CommunityDraft>) => onChange({ ...draft, ...patch });

  return (
    <div className="flex flex-col gap-3">
      <PhotoGallery
        partnerId={partnerId}
        value={draft.photoPaths}
        onChange={(photoPaths) => set({ photoPaths })}
        onBusyChange={onBusyChange}
      />

      <label className="flex flex-col gap-1.5">
        <span className={labelText}>Activity name</span>
        <input
          value={draft.name}
          onChange={(e) => set({ name: e.target.value })}
          placeholder="Sunrise Beach Cleanup"
          className={inputClass}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={labelText}>Organiser or NGO name</span>
        <input
          value={draft.organizerName}
          onChange={(e) => set({ organizerName: e.target.value })}
          placeholder="Reef Watch Andaman"
          className={inputClass}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={labelText}>Island</span>
        <select
          value={draft.islandSlug}
          onChange={(e) => set({ islandSlug: e.target.value })}
          className={inputClass}
        >
          {ISLANDS.map((i) => (
            <option key={i.slug} value={i.slug}>
              {i.full}
            </option>
          ))}
        </select>
      </label>

      <div className="flex gap-3">
        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className={labelText}>Date</span>
          <input
            type="date"
            value={draft.date}
            onChange={(e) => set({ date: e.target.value })}
            className={inputClass}
          />
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className={labelText}>Start time</span>
          <input
            type="time"
            value={draft.time}
            onChange={(e) => set({ time: e.target.value })}
            className={inputClass}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className={labelText}>End time — optional</span>
        <input
          type="time"
          value={draft.endTime}
          onChange={(e) => set({ endTime: e.target.value })}
          className={inputClass}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={labelText}>Meeting point</span>
        <input
          value={draft.meetingPoint}
          onChange={(e) => set({ meetingPoint: e.target.value })}
          placeholder="Car park at the north end of Corbyn's Cove"
          className={inputClass}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={labelText}>Google Maps link (optional)</span>
        <input
          type="url"
          inputMode="url"
          value={draft.mapsUrl}
          onChange={(e) => set({ mapsUrl: e.target.value })}
          placeholder="https://maps.app.goo.gl/…"
          className={inputClass}
        />
        <span className={hintText}>
          Paste a Maps pin for the exact meeting point — people get a Directions button to it.
        </span>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={labelText}>What to bring (optional)</span>
        <textarea
          value={draft.whatToBring}
          onChange={(e) => set({ whatToBring: e.target.value })}
          rows={2}
          placeholder="Water, hat, closed shoes, sunscreen. Gloves and bags provided."
          className={areaClass}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={labelText}>Safety notes (optional)</span>
        <textarea
          value={draft.safetyNotes}
          onChange={(e) => set({ safetyNotes: e.target.value })}
          rows={2}
          placeholder="Rocky shoreline in places. Under-16s must be with an adult."
          className={areaClass}
        />
      </label>

      <div className="flex gap-3">
        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className={labelText}>Minimum age (optional)</span>
          <input
            type="number"
            inputMode="numeric"
            value={draft.minAge}
            onChange={(e) => set({ minAge: e.target.value })}
            placeholder="—"
            className={inputClass}
          />
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className={labelText}>Maximum age (optional)</span>
          <input
            type="number"
            inputMode="numeric"
            value={draft.maxAge}
            onChange={(e) => set({ maxAge: e.target.value })}
            placeholder="—"
            className={inputClass}
          />
        </label>
      </div>

      <div className="flex gap-3">
        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className={labelText}>Primary contact</span>
          <input
            value={draft.contactName}
            onChange={(e) => set({ contactName: e.target.value })}
            placeholder="Name"
            className={inputClass}
          />
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className={labelText}>Contact number</span>
          <input
            type="tel"
            inputMode="numeric"
            value={draft.contactPhone}
            onChange={(e) => set({ contactPhone: e.target.value })}
            placeholder="Phone"
            className={inputClass}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className={labelText}>WhatsApp group link (optional)</span>
        <input
          type="url"
          inputMode="url"
          value={draft.whatsappGroupUrl}
          onChange={(e) => set({ whatsappGroupUrl: e.target.value })}
          placeholder="https://chat.whatsapp.com/…"
          className={inputClass}
        />
        <span className={hintText}>
          Shown to people right after they sign up, as a “Join the WhatsApp group” button.
        </span>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={labelText}>Description</span>
        <textarea
          value={draft.about}
          onChange={(e) => set({ about: e.target.value })}
          rows={3}
          placeholder="What you'll be doing, who it's for, how long it runs."
          className={areaClass}
        />
      </label>
    </div>
  );
}
