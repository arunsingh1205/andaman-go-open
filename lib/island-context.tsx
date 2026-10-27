"use client";

import {
  createContext,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  DEFAULT_ISLAND_ID,
  ISLAND_COOKIE,
  ISLANDS,
  isIslandId,
  type IslandId,
} from "./islands";
import type { SeaReport } from "./sea-report";

export { ISLANDS } from "./islands";

function writeCookie(id: IslandId) {
  // A year, so "remembering the island" doesn't quietly expire on someone —
  // path=/ so every route sees it, not just the one that set it.
  document.cookie = `${ISLAND_COOKIE}=${id}; path=/; max-age=31536000; samesite=lax`;
}

function readCookie(): IslandId | null {
  const match = document.cookie.match(
    new RegExp(`(?:^|;\\s*)${ISLAND_COOKIE}=([^;]*)`),
  );
  const value = match?.[1];
  return isIslandId(value) ? value : null;
}

/** Whether the traveller (or a previous auto-detection — see
 *  app/location-bootstrap.tsx) has ever actually set an island, as opposed
 *  to everyone's shared starting point of DEFAULT_ISLAND_ID. Exported so
 *  location-based auto-selection only ever runs on a genuinely first visit —
 *  it should never fight a choice, manual or automatic, that already
 *  happened. */
export function hasChosenIsland(): boolean {
  return readCookie() !== null;
}

// The cookie *is* the store. useSyncExternalStore is what lets a value that
// differs between server and client be read without an effect and without a
// hydration mismatch: React renders getServerSnapshot() on the server and
// again for hydration, then immediately re-renders with getSnapshot(). That
// is the sanctioned pattern for exactly this, and it keeps the React
// Compiler's set-state-in-effect rule happy, which a useEffect + setState
// version does not.
const listeners = new Set<() => void>();
let snapshot: IslandId | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): IslandId {
  // Cached rather than re-parsed per render: useSyncExternalStore calls this
  // on every render, and nothing but setIsland() below ever writes the
  // cookie, so the cache can only go stale if someone edits it by hand.
  snapshot ??= readCookie() ?? DEFAULT_ISLAND_ID;
  return snapshot;
}

// The server has no cookie jar, and a statically rendered page has no
// request at all — so everyone's HTML says DEFAULT_ISLAND_ID and the client
// corrects it a tick later.
function getServerSnapshot(): IslandId {
  return DEFAULT_ISLAND_ID;
}

function setIsland(id: IslandId) {
  writeCookie(id);
  snapshot = id;
  listeners.forEach((listener) => listener());
}

type IslandContextValue = {
  islandId: IslandId;
  setIslandId: (id: IslandId) => void;
  seaReports: Record<IslandId, SeaReport>;
};

const IslandContext = createContext<IslandContextValue | null>(null);

// The island the picker starts on used to be read server-side, in
// app/layout.tsx, with cookies(). That one call made the root layout — and
// therefore every route in the app, including the marketing page and the
// coming-soon page — render per request and cache nowhere. See the note in
// app/layout.tsx.
//
// So it is read here instead. State starts at DEFAULT_ISLAND_ID, which is
// what the server renders too, so the server HTML and the client's first
// paint agree and there is no hydration mismatch. The effect then corrects
// it from the cookie on mount, for anyone who has actually picked an island.
//
// The server still knows the real island wherever it matters: every
// traveller page calls currentIslandSlug() itself and queries Supabase with
// it, so the *listings* are right in the server-rendered HTML from the first
// byte. What this defers by one tick is only the picker's own label, on
// routes that are force-dynamic and behind the coming-soon gate anyway.
export function IslandProvider({
  children,
  seaReports,
}: {
  children: ReactNode;
  seaReports: Record<IslandId, SeaReport>;
}) {
  const islandId = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const router = useRouter();

  const setIslandId = (id: IslandId) => {
    setIsland(id);
    // Server Components (Popular nearby, trip strip, rental price teaser…)
    // read the island cookie once per request — without this they'd keep
    // showing whatever island was selected when the page first loaded.
    router.refresh();
  };

  return (
    <IslandContext.Provider value={{ islandId, setIslandId, seaReports }}>
      {children}
    </IslandContext.Provider>
  );
}

export function useIsland() {
  const ctx = useContext(IslandContext);
  if (!ctx) throw new Error("useIsland must be used within an IslandProvider");
  const base = ISLANDS.find((i) => i.id === ctx.islandId)!;
  // The live sea report wins over the static line/calm baked into ISLANDS;
  // that static pair is only the offline fallback now (see lib/sea-report.ts).
  const report = ctx.seaReports[ctx.islandId];
  const island = report ? { ...base, line: report.line, calm: report.calm } : base;
  return { island, setIslandId: ctx.setIslandId };
}
