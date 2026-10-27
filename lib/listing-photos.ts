// Listing galleries for the traveller catalogue readers — the bulk-fetch half
// of 037.
//
// This lives apart from lib/photos.ts on purpose: photos.ts stays import-free
// (just a URL join and a constant) so the partner PhotoGallery component can
// read LISTING_PHOTO_MAX from it without dragging supabase-js into the client
// bundle. Everything here is server-only.
//
// There is no foreign key from listing_photos back to the catalogue tables
// (same reason booking_items has none — the kind tells you the table), so
// there is no PostgREST embed to lean on. Instead each reader hands us the ids
// it already fetched and gets back a map of listing_id -> ordered photo URLs.

import { supabase } from "./supabase";
import { listingPhotoUrl, type ListingPhotoKind } from "./photos";

type Row = { listing_id: string; storage_path: string };

/** Ordered photo URLs for each listing id, cover first. Ids with no photos
 *  simply aren't in the map — callers fall back to `?? []`. */
export async function galleriesFor(
  kind: ListingPhotoKind,
  ids: string[],
): Promise<Map<string, string[]>> {
  const byListing = new Map<string, string[]>();
  if (ids.length === 0) return byListing;

  const { data } = await supabase
    .from("listing_photos")
    .select("listing_id, storage_path, sort_order")
    .eq("listing_kind", kind)
    .in("listing_id", ids)
    .order("sort_order");

  for (const r of (data ?? []) as Row[]) {
    const arr = byListing.get(r.listing_id) ?? [];
    arr.push(listingPhotoUrl(r.storage_path));
    byListing.set(r.listing_id, arr);
  }
  return byListing;
}
