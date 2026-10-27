"use server";

// Turning a GPS pin into a short place name — "South Point", not
// "11.6234, 92.7265". Nominatim (OpenStreetMap) rather than Google: free, no
// API key, no billing account, matching the "no Google Maps API" call made
// for the rest of cab dispatch (077). Server-side only: Nominatim's usage
// policy asks for a real User-Agent identifying the app, which a browser
// fetch can't set (it's a forbidden header in JS), and caps at ~1 request/
// second — both are non-issues from a server action firing once per pin.

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse";
const USER_AGENT = "AndamanGo/1.0 (+https://andamango.app; cab pickup pins)";

type NominatimAddress = {
  tourism?: string;
  amenity?: string;
  shop?: string;
  leisure?: string;
  road?: string;
  neighbourhood?: string;
  suburb?: string;
  village?: string;
  town?: string;
  city_district?: string;
  county?: string;
};

/**
 * A short, human place name for a pin, or null if the lookup fails or turns
 * up nothing usable — callers fall back to "Location shared" in that case,
 * never blocking the booking on a third-party service being slow or down.
 */
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const url = `${NOMINATIM_URL}?format=jsonv2&lat=${lat}&lon=${lng}&zoom=17&addressdetails=1`;
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;

    const data = (await res.json()) as { address?: NominatimAddress; display_name?: string };
    const a = data.address;
    // Most specific named thing first — a resort or landmark reads better
    // than a road, which reads better than a district.
    const name =
      a?.tourism ||
      a?.amenity ||
      a?.shop ||
      a?.leisure ||
      a?.neighbourhood ||
      a?.suburb ||
      a?.road ||
      a?.village ||
      a?.town ||
      a?.city_district ||
      a?.county ||
      data.display_name?.split(",")[0];

    return name?.trim() || null;
  } catch {
    // Timed out, offline, Nominatim rate-limited us — none of that should
    // ever fail a booking; the pin itself (lat/lng) is already captured.
    return null;
  }
}
