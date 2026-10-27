"use server";

// A real Server Action, split out of admin-auth.ts so that file's read
// functions can be wrapped in React's cache() (see admin-auth.ts for why
// the two can't share a file).

import { supabaseServer } from "./supabase-server";

/** Sign the admin out, so the next auth check falls straight back to login. */
export async function signOutAdmin(): Promise<void> {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
}
