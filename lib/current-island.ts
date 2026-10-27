// Server-side counterpart to lib/island-context.tsx. The picker is client
// state, but list pages are Server Components that query Supabase directly —
// this is the bridge, reading the same cookie the picker writes.

import { cookies } from "next/headers";
import { DEFAULT_ISLAND_ID, ISLAND_COOKIE, ISLANDS, isIslandId, type IslandId } from "./islands";

export async function currentIslandId(): Promise<IslandId> {
  const raw = (await cookies()).get(ISLAND_COOKIE)?.value;
  return isIslandId(raw) ? raw : DEFAULT_ISLAND_ID;
}

export async function currentIslandSlug(): Promise<string> {
  const id = await currentIslandId();
  return ISLANDS.find((i) => i.id === id)!.slug;
}
