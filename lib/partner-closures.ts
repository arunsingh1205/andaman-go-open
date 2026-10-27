"use server";

// Closing a date, from the partner's side — the write half of
// 021-listing-closures.sql, plus the two reads the Calendar tab needs to
// draw the controls. Same shape as partner-register.ts: look the caller's
// own partner up server-side (or take a partnerId already resolved from the
// session), never trust the client about which business it is.

import { supabaseServer } from "./supabase-server";

export type CloseableKind = "activity" | "trip" | "rental" | "stay";

export type CloseableListing = {
  id: string;
  kind: CloseableKind;
  title: string;
};

export type PartnerClosure = {
  kind: CloseableKind;
  subjectId: string;
  onDate: string;
  reason: string;
};

export type CloseResult = { ok: boolean; message: string };

const GENERIC_FAILURE = "Something went wrong. Try again.";

function firstRow<T>(data: unknown): T | null {
  return Array.isArray(data) && data.length > 0 ? (data[0] as T) : null;
}

/** What this partner can close a date on: every activity and trip, plus — for
 *  a rental shop — the shop itself (a rental's subject is the partner id, and
 *  035 taught close_partner_date about 'rental') — and, for a stay, each of
 *  its own room types (096 taught close_partner_date about 'stay'; the
 *  closeable subject is the room type, not the property). Relies on the
 *  "partner sees own X" RLS from 011/016/096. */
export async function getCloseableListings(
  partnerId: string,
): Promise<CloseableListing[]> {
  const supabase = await supabaseServer();

  const [activities, trips, partner, stays] = await Promise.all([
    supabase.from("activities").select("id, name").eq("partner_id", partnerId).order("name"),
    supabase.from("trips").select("id, title").eq("partner_id", partnerId).order("title"),
    supabase.from("partners").select("kind, name").eq("id", partnerId).maybeSingle(),
    supabase
      .from("stays")
      .select("name, stay_room_types ( id, name )")
      .eq("partner_id", partnerId),
  ]);

  const out: CloseableListing[] = [];
  for (const row of activities.data ?? []) {
    out.push({ id: row.id as string, kind: "activity", title: row.name as string });
  }
  for (const row of trips.data ?? []) {
    out.push({ id: row.id as string, kind: "trip", title: row.title as string });
  }
  if (partner.data?.kind === "rental") {
    out.push({ id: partnerId, kind: "rental", title: `${partner.data.name} — all vehicles` });
  }
  for (const stay of (stays.data ?? []) as { name: string; stay_room_types: { id: string; name: string }[] }[]) {
    for (const rt of stay.stay_room_types ?? []) {
      out.push({ id: rt.id, kind: "stay", title: `${stay.name} — ${rt.name}` });
    }
  }
  return out;
}

/** This partner's closures from today on. listing_closures is public-select,
 *  so scoping is the partner_id filter — plus an actual date filter, which
 *  this claimed to have all along but never applied; a closure from a year
 *  ago has no bearing on "what's closed right now" and was making this
 *  slower every year for no reason. */
export async function getPartnerClosures(partnerId: string, fromDateKey: string): Promise<PartnerClosure[]> {
  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from("listing_closures")
    .select("kind, subject_id, on_date, reason")
    .eq("partner_id", partnerId)
    .gte("on_date", fromDateKey)
    .order("on_date");

  if (error || !data) return [];

  return data.map((row) => ({
    kind: row.kind as CloseableKind,
    subjectId: row.subject_id as string,
    onDate: row.on_date as string,
    reason: row.reason as string,
  }));
}

export async function closePartnerDate(
  kind: CloseableKind,
  subjectId: string,
  onDate: string,
  reason: string,
): Promise<CloseResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("close_partner_date", {
    p_kind: kind,
    p_subject_id: subjectId,
    p_on_date: onDate,
    p_reason: reason,
  });
  if (error) return { ok: false, message: GENERIC_FAILURE };
  const row = firstRow<{ ok: boolean; message: string }>(data);
  return { ok: Boolean(row?.ok), message: row?.message ?? GENERIC_FAILURE };
}

export async function reopenPartnerDate(
  kind: CloseableKind,
  subjectId: string,
  onDate: string,
): Promise<CloseResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("reopen_partner_date", {
    p_kind: kind,
    p_subject_id: subjectId,
    p_on_date: onDate,
  });
  if (error) return { ok: false, message: GENERIC_FAILURE };
  const row = firstRow<{ ok: boolean; message: string }>(data);
  return { ok: Boolean(row?.ok), message: row?.message ?? GENERIC_FAILURE };
}

export async function weatherClosePartner(
  onDate: string,
  reason: string,
): Promise<CloseResult> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("weather_close_partner", {
    p_on_date: onDate,
    p_reason: reason,
  });
  if (error) return { ok: false, message: GENERIC_FAILURE };
  const row = firstRow<{ ok: boolean; message: string }>(data);
  return { ok: Boolean(row?.ok), message: row?.message ?? GENERIC_FAILURE };
}
