// The one place the app talks to Supabase.
//
// Everything reads through this client — no screen imports it directly, only
// the lib/* modules do. That is the same seam that has been there all along:
// the screens ask lib/activities.ts for activities and do not care whether
// the answer came from an array or a database.
//
// On the key: NEXT_PUBLIC_SUPABASE_ANON_KEY is meant to be public. It ships
// inside the JavaScript sent to the browser and anyone can read it. What
// protects the data is the row level security policies in schema.sql, not the
// secrecy of this key. The service_role key is the opposite — it ignores every
// policy — so it must never appear in a NEXT_PUBLIC_ variable or in git.

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;

// Supabase has renamed this variable twice. Accept whichever name their
// Connect panel gave you rather than making you rename it by hand.
const anonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_OR_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!url || !anonKey) {
  throw new Error(
    [
      "Supabase is not configured.",
      "",
      "Create a file called .env.local in the project root (next to package.json):",
      "",
      "  NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co",
      "  NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key",
      "",
      "Both are filled in for you in the Supabase dashboard, under Connect →",
      "Framework → Next.js. Then stop the dev server and start it again —",
      "Next.js only reads environment variables when it boots.",
    ].join("\n"),
  );
}

export const supabase = createClient(url, anonKey, {
  // This client only ever reads the public catalogue — it has no business
  // touching the session. Its own storage key keeps it out of the way of
  // lib/supabase-browser.ts, which is the one that owns the traveller's
  // identity. Two clients sharing a key is the "Multiple GoTrueClient
  // instances" warning, and the undefined behaviour it warns about is a
  // session getting clobbered.
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    storageKey: "andaman-go-catalogue",
  },

  // Every read is uncached, which is what makes the pages that use them
  // render per request instead of freezing at build time. Without this a
  // deployed build would keep showing whatever the seat counts were on the
  // day it was deployed — the staleness problem, but worse, because it
  // would look like it was working.
  global: {
    fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
  },
});

/**
 * Every read goes through here so that a failure is loud and says which query
 * broke. Supabase returns errors in the result rather than throwing, which is
 * easy to ignore by accident — a screen then renders as if there were simply
 * no activities today.
 */
export function unwrap<T>(
  result: { data: T | null; error: { message: string } | null },
  what: string,
): T {
  if (result.error) {
    throw new Error(`Supabase: could not load ${what} — ${result.error.message}`);
  }
  if (result.data === null) {
    throw new Error(`Supabase: ${what} came back empty`);
  }
  return result.data;
}
