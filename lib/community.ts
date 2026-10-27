// Community Service — free activities a local community or NGO runs (beach
// cleanups, volunteer days, drives). Read from Supabase.
//
// Shaped like lib/events.ts: a community service happens once, on a date, so
// the row stores that date and this module does no timetable expanding. There
// are no seats and no price, so there's no availability query either — the
// only question a reader asks is "is it still listed and in the future".

import { addDays, BOOKING_CUTOFF_HOURS, dayKey as fmtDayKey, fmtClock, fmtDayLabel, fmtDayNum, instantIso, isPastCutoff, todayIST } from "./date";
import { galleriesFor } from "./listing-photos";
import { supabase, unwrap } from "./supabase";

export type CommunityService = {
  id: string;
  slug: string;
  mark: string;
  /** Partner-uploaded photos, cover first — empty until the organiser adds
   *  any (148). Falls back to `mark`'s coloured tile everywhere this is
   *  empty, and to the site's generic card for the share-link preview. */
  photos: string[];
  name: string;
  organizerName: string;
  about: string;
  islandSlug: string;
  dayKey: string;
  dayLabel: string;
  dayNum: string;
  timeLabel: string;
  /** The exact instant it starts, ISO. */
  startsAt: string;
  /** Set when the organiser gave an approximate end time — descriptive only. */
  endTimeLabel: string | null;
  /** Organiser-set Google Maps pin — null until they add one. */
  mapsUrl: string | null;
  meetingPoint: string;
  whatToBring: string | null;
  safetyNotes: string | null;
  minAge: number | null;
  maxAge: number | null;
  contactName: string;
  contactPhone: string;
};

// The organiser's WhatsApp group link is deliberately NOT read here — it's
// handed back by community_signup() (072) only after someone signs up, so it
// never ships in the open page's HTML.

/** How far ahead the Community screen looks. */
const DAYS_AHEAD = 30;

type Row = {
  id: string;
  slug: string;
  mark: string;
  name: string;
  organizer_name: string;
  about: string;
  island_slug: string;
  on_date: string;
  time_mins: number;
  end_time_mins: number | null;
  maps_url: string | null;
  meeting_point: string;
  what_to_bring: string | null;
  safety_notes: string | null;
  min_age: number | null;
  max_age: number | null;
  contact_name: string;
  contact_phone: string;
};

// No partners join needed: the "listed community services are public" RLS
// policy (072) already hides anything whose business isn't approved.
const SELECT = `
  id, slug, mark, name, organizer_name, about, island_slug, on_date, time_mins, end_time_mins,
  maps_url, meeting_point, what_to_bring, safety_notes, min_age, max_age,
  contact_name, contact_phone
`;

const asDate = (onDate: string) => new Date(`${onDate}T00:00:00Z`);

function toCommunityService(row: Row, photos: string[]): CommunityService {
  const date = asDate(row.on_date);
  return {
    id: row.id,
    slug: row.slug,
    mark: row.mark,
    photos,
    name: row.name,
    organizerName: row.organizer_name,
    about: row.about,
    islandSlug: row.island_slug,
    dayKey: row.on_date,
    dayLabel: fmtDayLabel(date),
    dayNum: fmtDayNum(date),
    timeLabel: fmtClock(row.time_mins),
    startsAt: instantIso(row.on_date, row.time_mins),
    endTimeLabel: row.end_time_mins != null ? fmtClock(row.end_time_mins) : null,
    mapsUrl: row.maps_url,
    meetingPoint: row.meeting_point,
    whatToBring: row.what_to_bring,
    safetyNotes: row.safety_notes,
    minAge: row.min_age,
    maxAge: row.max_age,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
  };
}

async function load(filter?: { slug?: string; islandSlug?: string }): Promise<CommunityService[]> {
  const today = todayIST();
  const horizon = addDays(today, DAYS_AHEAD);

  let query = supabase
    .from("community_services")
    .select(SELECT)
    .eq("is_listed", true)
    .gte("on_date", fmtDayKey(today))
    .lte("on_date", fmtDayKey(horizon));

  if (filter?.slug) query = query.eq("slug", filter.slug);
  if (filter?.islandSlug) query = query.eq("island_slug", filter.islandSlug);

  const rows = (await query
    .order("on_date")
    .order("time_mins")
    .then((r) => unwrap(r, "community services"))) as unknown as Row[];

  const galleries = await galleriesFor("community", rows.map((r) => r.id));

  // Same 2-hour close as every other timed category (lib/date.ts
  // BOOKING_CUTOFF_HOURS) — a cleanup that started an hour ago shouldn't
  // still be inviting sign-ups.
  return rows
    .map((row) => toCommunityService(row, galleries.get(row.id) ?? []))
    .filter((s) => !isPastCutoff(s.startsAt, BOOKING_CUTOFF_HOURS));
}

export async function getCommunityServices(islandSlug?: string): Promise<CommunityService[]> {
  return load(islandSlug ? { islandSlug } : undefined);
}

export async function getCommunityService(slug: string): Promise<CommunityService | undefined> {
  return (await load({ slug }))[0];
}

/** A short "who it's for" line from the age limits, or null when there are none. */
export function ageLimitLabel(service: Pick<CommunityService, "minAge" | "maxAge">): string | null {
  const { minAge, maxAge } = service;
  if (minAge != null && maxAge != null) return `Ages ${minAge}–${maxAge}`;
  if (minAge != null) return `Ages ${minAge}+`;
  if (maxAge != null) return `Up to age ${maxAge}`;
  return null;
}
