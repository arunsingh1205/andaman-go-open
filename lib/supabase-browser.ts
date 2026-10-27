"use client";

// The client that runs in the phone, and the thing that gives a visitor an
// identity without asking them for anything.
//
// A traveller standing on a jetty with one bar of signal should not have to
// create an account before they can hold a table. So the first time the app
// opens, Supabase quietly issues an anonymous account. It is a real row in
// auth.users with a real token — the booking has a genuine owner, and the
// row level security rules work exactly as they will for a signed-in user.
//
// When phone sign-in arrives, that anonymous account gets the phone number
// attached to it rather than being replaced, so bookings made before signing
// up come along.
//
// The honest limitation: this identity lives in the browser's cookies. Clear
// them before adding a phone number and those bookings are unreachable. That
// is precisely why the reference code also goes out over WhatsApp.

import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_URL, assertSupabaseEnv } from "./supabase-env";

assertSupabaseEnv();

export const supabaseBrowser = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * Make sure there is a session before doing anything that needs one.
 *
 * Call this immediately before booking rather than trusting that start-up
 * finished. Someone on a slow connection can reach a Book button before the
 * anonymous sign-in has come back, and "not signed in" is a miserable thing
 * to show a person who has just decided to give you money.
 */
export async function ensureSession(): Promise<string | null> {
  const { data } = await supabaseBrowser.auth.getSession();
  if (data.session) return data.session.user.id;

  const { data: created, error } = await supabaseBrowser.auth.signInAnonymously();
  if (error) {
    // Almost always one thing: the toggle is off.
    throw new Error(
      `Could not start a session — ${error.message}. In the Supabase dashboard, ` +
        "turn on Authentication → Sign In / Providers → Anonymous sign-ins.",
    );
  }

  return created.session?.user.id ?? null;
}
