// Plain data — no "use client", no server-only APIs — so both the picker
// (client) and page.tsx queries (server) can import the same list and never
// drift into two different ideas of what islands exist.
//
// The islands were officially renamed (migration 041): Port Blair is now Sri
// Vijaya Puram, Havelock is Swaraj Dweep, Neil is Shaheed Dweep. `name` is the
// new name — what the app leads with. `former` is what travellers still say and
// search for, kept in parentheses in `full` for the headings and forms where
// there's room for it.

export const ISLANDS = [
  {
    id: "pb",
    slug: "port-blair",
    name: "Sri Vijaya Puram",
    former: "Port Blair",
    full: "Sri Vijaya Puram (Port Blair)",
    // line/calm here are only the fallback for when the live marine forecast
    // can't be reached — see lib/sea-report.ts.
    line: "Sea calm · easy crossings all day",
    calm: true,
    // Roughly the town centre — see nearestIslandId() below. The three
    // islands are tens of km apart, far past any GPS error, so this only
    // needs to be "clearly on the right island," not survey-accurate.
    lat: 11.6234,
    lng: 92.7265,
  },
  {
    id: "hv",
    slug: "havelock",
    name: "Swaraj Dweep",
    former: "Havelock",
    full: "Swaraj Dweep (Havelock)",
    line: "Calm this morning · choppier after 2 PM",
    calm: false,
    lat: 12.008,
    lng: 92.982,
  },
  {
    id: "nl",
    slug: "neil",
    name: "Shaheed Dweep",
    former: "Neil",
    full: "Shaheed Dweep (Neil)",
    line: "Sea calm · breezy from late afternoon",
    calm: true,
    lat: 11.83,
    lng: 93.0503,
  },
] as const;

export type IslandId = (typeof ISLANDS)[number]["id"];

/** Great-circle distance in km — accurate enough at this scale; the islands
 *  are tens of km apart, so even a fairly rough formula never misclassifies. */
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Whichever of the three islands a coordinate is closest to — always
 *  returns one, so callers that only want this for points already known to
 *  be somewhere in Andaman & Nicobar (see lib/andaman-bounds.ts) don't need
 *  to handle "none of them." */
export function nearestIslandId(lat: number, lng: number): IslandId {
  let best: IslandId = ISLANDS[0].id;
  let bestDist = Infinity;
  for (const island of ISLANDS) {
    const dist = haversineKm(lat, lng, island.lat, island.lng);
    if (dist < bestDist) {
      bestDist = dist;
      best = island.id;
    }
  }
  return best;
}

// Almost everything bookable today is seeded under Havelock — defaulting a
// first-time visitor to Port Blair would land them on an app that looks
// empty before they've ever touched the picker.
export const DEFAULT_ISLAND_ID: IslandId = "hv";

/** The cookie the picker writes to and every server page reads from. */
export const ISLAND_COOKIE = "island";

export function isIslandId(value: string | undefined): value is IslandId {
  return ISLANDS.some((i) => i.id === value);
}

export function islandSlug(id: IslandId): string {
  return ISLANDS.find((i) => i.id === id)!.slug;
}

/** The display name for an island slug — the new name, or a tidied slug for
 *  anything not in the picker list (Baratang). */
export function islandLabel(slug: string): string {
  const known = ISLANDS.find((i) => i.slug === slug);
  if (known) return known.name;
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
