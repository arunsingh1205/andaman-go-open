"use server";

// One call: log that a traveller opened a listing's page. Fire-and-forget
// from <ViewBeacon>; the DB function (028) resolves the slug to a listing
// and its partner itself, so nothing here is trusted.
//
// "cab" resolves to a cab operator (a partner), the way "rental" resolves to
// a rental shop — see the record_listing_view branch in the cab migration.

import { supabaseServer } from "./supabase-server";

export type ViewKind = "activity" | "stay" | "event" | "trip" | "cab" | "rental";

export async function recordListingView(kind: ViewKind, subject: string): Promise<void> {
  try {
    const supabase = await supabaseServer();
    await supabase.rpc("record_listing_view", { p_kind: kind, p_subject: subject });
  } catch {
    // A missed view count is nobody's problem.
  }
}
